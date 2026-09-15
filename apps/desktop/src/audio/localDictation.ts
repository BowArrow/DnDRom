import { assertLocalAiEndpoint } from "../ai/openAiClient";

export function encodePcmWav(samples: Float32Array, sampleRate = 16000): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2), view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
  return new Blob([bytes], { type: "audio/wav" });
}

export async function transcribeLocally(endpoint: string, audio: Blob, signal?: AbortSignal): Promise<string> {
  const base = assertLocalAiEndpoint(endpoint);
  const url = /\/(inference|audio\/transcriptions)$/.test(base) ? base : `${base}/inference`;
  const form = new FormData(); form.append("file", audio, "scene-dictation.wav"); form.append("response_format", "json"); form.append("model", "whisper-1");
  const response = await fetch(url, { method: "POST", body: form, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]), redirect: "error" });
  if (!response.ok) throw new Error(`Local transcription failed (HTTP ${response.status})`);
  const result = await response.json() as { text?: string };
  if (!result.text?.trim()) throw new Error("Local transcription returned no speech");
  return result.text.trim();
}

export interface LocalDictationCapture { stop: () => void; abort: () => void }

/** Browser records audio only. Transcription is sent exclusively to loopback. */
export async function startLocalDictation(endpoint: string, onText: (text: string) => void, onError: (message: string) => void, onState: (state: "recording" | "transcribing" | "idle") => void): Promise<LocalDictationCapture> {
  if (!endpoint.trim()) throw new Error("Set a local Whisper endpoint below to use private dictation");
  assertLocalAiEndpoint(endpoint);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream); } catch (error) { stream.getTracks().forEach((track) => track.stop()); throw error; }
  const controller = new AbortController(), chunks: Blob[] = [];
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const stop = () => { if (recorder.state !== "inactive") recorder.stop(); release(); };
  const timer = window.setTimeout(stop, 90_000);
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.onerror = () => { controller.abort(); stop(); onError("Microphone recording failed"); onState("idle"); };
  recorder.onstop = () => {
    clearTimeout(timer); release();
    void (async () => {
      if (controller.signal.aborted) return;
      onState("transcribing");
      const context = new AudioContext();
      try {
        const decoded = await context.decodeAudioData(await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer());
        const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
        const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
        const rendered = await offline.startRendering();
        controller.signal.throwIfAborted();
        const text = await transcribeLocally(endpoint, encodePcmWav(rendered.getChannelData(0)), controller.signal);
        if (!controller.signal.aborted) onText(text);
      } finally { await context.close(); }
    })().catch((error: unknown) => { if (!controller.signal.aborted) onError(error instanceof Error ? error.message : "Local dictation failed"); }).finally(() => onState("idle"));
  };
  recorder.start(1000); onState("recording");
  return { stop, abort: () => { controller.abort(); clearTimeout(timer); stop(); onState("idle"); } };
}
