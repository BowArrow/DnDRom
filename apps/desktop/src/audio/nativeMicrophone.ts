import { nativeCall } from "../migration/nativeBridge";

/** Poll a bounded native buffer; preserve fractional resampling phase between pulls. */
export async function nativeMicrophone(onFrame: (samples: Float32Array) => void, onError: (message: string) => void) {
  await nativeCall("audio.start");
  let stopped = false, busy = false, phase = 0, carry: number[] = [];
  const pull = async () => {
    if (busy || stopped) return; busy = true;
    try {
      const frame = await nativeCall<{ pcm: string; sampleRate: number }>("audio.pull");
      if (stopped) return;
      const bytes = Uint8Array.from(atob(frame.pcm), c => c.charCodeAt(0)), view = new DataView(bytes.buffer);
      for (let i = 0; i < bytes.length; i += 2) carry.push(view.getInt16(i, true) / 32768);
      const ratio = frame.sampleRate / 16000, samples: number[] = [];
      while (phase + ratio < carry.length) {
        const first = Math.floor(phase), end = Math.floor(phase + ratio); let sum = 0;
        for (let i = first; i < end; i++) sum += carry[i]; samples.push(sum / Math.max(1, end - first)); phase += ratio;
      }
      const consumed = Math.floor(phase); carry = carry.slice(consumed); phase -= consumed;
      if (samples.length) onFrame(new Float32Array(samples));
    } catch (error) { onError(String(error)); stopped = true; clearInterval(timer); void nativeCall("audio.stop").catch(() => {}); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void pull(), 80);
  return {
    abort: () => { stopped = true; clearInterval(timer); void nativeCall("audio.stop").catch(() => {}); },
    stop: async () => { clearInterval(timer); while (busy) await new Promise(resolve => setTimeout(resolve, 10)); await pull(); stopped = true; await nativeCall("audio.stop"); },
  };
}
