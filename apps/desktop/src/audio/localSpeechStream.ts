import { assertLocalAiEndpoint } from "../ai/openAiClient";
import { encodePcmWav, transcribeLocally } from "./localDictation";
import { isUnreal } from "../migration/nativeBridge";
import { ensureLocalRuntime } from "../ai/localRuntime";
import { nativeMicrophone } from "./nativeMicrophone";

export interface SpeechChunk { samples: Float32Array; segment: number; utterance: number; finalSegment: boolean; finalUtterance: boolean }

/** Voice activity and short overlapping-context updates run without a model.
 * Final segments are never dropped; obsolete partial work is coalesced. */
export class SpeechChunker {
  private samples: number[] = [];
  private silence = 0;
  private active = false;
  private lastPartial = 0;
  private segment = 0;
  private utterance = 0;
  private preRoll: number[] = [];
  private segmentVoiced = false;
  constructor(private readonly emit: (chunk: SpeechChunk) => void, private readonly onSpeechStart: (utterance: number) => void, private readonly sampleRate = 16000) {}
  push(frame: Float32Array): void {
    const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / Math.max(1, frame.length));
    if (!this.active && rms < .018) { this.preRoll = [...this.preRoll, ...frame].slice(-Math.round(this.sampleRate * .15)); return; }
    if (!this.active) { this.active = true; this.utterance++; this.samples.push(...this.preRoll); this.preRoll = []; this.onSpeechStart(this.utterance); }
    this.segmentVoiced ||= rms >= .012;
    this.samples.push(...frame);
    this.silence = rms < .012 ? this.silence + frame.length : 0;
    if (this.silence >= this.sampleRate * .55) { this.flush(true); this.active = false; this.silence = 0; }
    else if (this.samples.length >= this.sampleRate * 8) this.flush(false);
    else if (this.samples.length - this.lastPartial >= this.sampleRate * 1.2) {
      this.lastPartial = this.samples.length;
      this.emit({ samples: new Float32Array(this.samples), segment: this.segment, utterance: this.utterance, finalSegment: false, finalUtterance: false });
    }
  }
  finish(): void { if (this.active) this.flush(true); this.active = false; }
  private flush(finalUtterance: boolean): void {
    if (!finalUtterance && this.samples.length < this.sampleRate * .2) { this.samples = []; this.lastPartial = 0; return; }
    this.emit({ samples: new Float32Array(this.segmentVoiced ? this.samples : []), segment: this.segment++, utterance: this.utterance, finalSegment: true, finalUtterance });
    this.samples = []; this.lastPartial = 0; this.segmentVoiced = false;
  }
}

export interface LocalSpeechStream { stop: () => void; abort: () => void }
export async function startLocalSpeechStream(endpoint: string, callbacks: { onPartial: (text: string) => void; onFinal: (text: string) => void; onSpeechStart: () => void; onError: (message: string) => void }): Promise<LocalSpeechStream> {
  const native = isUnreal();
  if (native) endpoint = (await ensureLocalRuntime("speech")).endpoint;
  if (!endpoint.trim()) throw new Error("Set the local Whisper endpoint in Session to enable speak mode");
  assertLocalAiEndpoint(endpoint);
  const stream = native ? null : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const context = native ? null : new AudioContext();
  let microphone: Awaited<ReturnType<typeof nativeMicrophone>> | null = null;
  const controller = new AbortController();
  let stopped = false, busy = false, latestUtterance = 0;
  let precedingSpeech = "";
  const pending: SpeechChunk[] = [], transcripts = new Map<number, Map<number, string>>();
  const pump = async () => {
    if (busy || controller.signal.aborted) return;
    busy = true;
    try {
      while (pending.length && !controller.signal.aborted) {
        const chunk = pending.shift()!;
        const text = chunk.samples.length ? await transcribeLocally(endpoint, encodePcmWav(chunk.samples), controller.signal) : "";
        if (controller.signal.aborted) return;
        if (chunk.utterance < latestUtterance && !chunk.finalSegment) continue;
        const segments = transcripts.get(chunk.utterance) ?? new Map<number, string>();
        if (text) segments.set(chunk.segment, text); transcripts.set(chunk.utterance, segments);
        const combined = [precedingSpeech, ...[...segments.entries()].sort((a, b) => a[0] - b[0]).map(([, content]) => content)].filter(Boolean).join(" ");
        if (chunk.finalUtterance) {
          transcripts.delete(chunk.utterance);
          // A pause can be shorter than local inference. Keep that completed
          // phrase and answer only after the newest phrase also finishes.
          if (chunk.utterance < latestUtterance) precedingSpeech = combined;
          else { precedingSpeech = ""; callbacks.onFinal(combined); }
        }
        else callbacks.onPartial(combined);
      }
    } catch (error) {
      if (!controller.signal.aborted) { callbacks.onError(error instanceof Error ? error.message : "Local transcription stopped"); abort(); }
    } finally { busy = false; }
  };
  const chunker = new SpeechChunker((chunk) => {
    const older = pending.findIndex((entry) => entry.segment === chunk.segment);
    if (older >= 0) pending[older] = chunk; else pending.push(chunk);
    // A slow local model cannot accumulate unbounded microphone recordings.
    if (pending.filter((entry) => entry.finalSegment).length > 8) { callbacks.onError("Local transcription cannot keep up. Speak mode stopped; use shorter phrases or a faster Whisper model."); abort(); return; }
    void pump();
  }, (utterance) => { latestUtterance = utterance; for (let i = pending.length - 1; i >= 0; i--) if (!pending[i].finalSegment) pending.splice(i, 1); callbacks.onSpeechStart(); });
  const release = () => { if (stopped) return; stopped = true; stream?.getTracks().forEach((track) => track.stop()); void context?.close(); microphone?.abort(); };
  const abort = () => { controller.abort(); pending.length = 0; transcripts.clear(); release(); };
  try {
    if (native) {
      microphone = await nativeMicrophone(samples => { if (!stopped) chunker.push(samples); }, message => { callbacks.onError(message); abort(); });
      return { stop: () => { void microphone!.stop().then(() => { chunker.finish(); release(); }).catch(error => { callbacks.onError(String(error)); abort(); }); }, abort };
    }
    if (!context || !stream) throw new Error("Audio capture did not initialize");
    await context.audioWorklet.addModule("/audio/local-capture.js");
    const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, "dndrom-local-capture");
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (stopped) return;
      const raw = event.data, ratio = context.sampleRate / 16000, samples = new Float32Array(Math.floor(raw.length / ratio));
      for (let i = 0; i < samples.length; i++) { const start = Math.floor(i * ratio), end = Math.min(raw.length, Math.floor((i + 1) * ratio)); let sum = 0; for (let j = start; j < end; j++) sum += raw[j]; samples[i] = sum / Math.max(1, end - start); }
      chunker.push(samples);
    };
    source.connect(node); node.connect(context.destination); await context.resume();
  } catch (error) { abort(); throw error; }
  return { stop: () => { chunker.finish(); release(); }, abort };
}
