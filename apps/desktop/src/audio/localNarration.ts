import { assertLocalAiEndpoint } from "../ai/openAiClient";

export interface LocalNarrationOptions { endpoint?: string; voice?: string; onError?: (message: string) => void }
export interface SpeechPlayback { done: Promise<void>; stop: () => void }
export interface NarrationBackend { synthesize: (text: string, signal: AbortSignal) => Promise<Blob>; play: (audio: Blob) => SpeechPlayback }

/** Synthesis of the next sentence overlaps playback of the current one. */
export class LocalNarrationQueue {
  private controller = new AbortController();
  private synthesis = Promise.resolve();
  private playback = Promise.resolve();
  private current: SpeechPlayback | null = null;
  private queued = 0;
  constructor(private readonly backend: NarrationBackend, private readonly onError: (message: string) => void = () => undefined) {}
  enqueue(text: string): void {
    if (!text.trim() || this.queued >= 32) return;
    this.queued++;
    const signal = this.controller.signal;
    // Serial inference prevents two speech models competing for the GPU.
    const rendered = this.synthesis.then(() => { signal.throwIfAborted(); return this.backend.synthesize(text, signal); });
    this.synthesis = rendered.then(() => undefined, () => undefined);
    // Attach rejection handling immediately even while earlier audio is playing.
    const ready = rendered.then((audio) => ({ audio }), (error: unknown) => ({ error }));
    this.playback = this.playback.then(async () => {
      const result = await ready; signal.throwIfAborted();
      if ("error" in result) throw result.error;
      const playback = this.backend.play(result.audio); this.current = playback;
      try { await playback.done; } finally { if (this.current === playback) this.current = null; }
    }).catch((error: unknown) => { if (!signal.aborted) this.onError(error instanceof Error ? error.message : "Local speech playback failed"); }).finally(() => { if (signal === this.controller.signal) this.queued = Math.max(0, this.queued - 1); });
  }
  stop(): void { this.controller.abort(); this.current?.stop(); this.current = null; this.controller = new AbortController(); this.synthesis = Promise.resolve(); this.playback = Promise.resolve(); this.queued = 0; }
}

const playBlob = (blob: Blob): SpeechPlayback => {
  const url = URL.createObjectURL(blob), audio = new Audio(url);
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; audio.onended = () => resolve(); audio.onerror = () => reject(new Error("Local speech audio could not be played")); void audio.play().catch(reject); }).finally(() => { audio.pause(); audio.removeAttribute("src"); URL.revokeObjectURL(url); });
  return { done, stop: () => { audio.pause(); finish(); } };
};
let queue: LocalNarrationQueue | null = null;
let queueKey = "";
export function stopLocalNarration(): void { queue?.stop(); if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }
export function queueLocalNarration(text: string, enabled: boolean, options: LocalNarrationOptions = {}): void {
  if (!enabled || !text.trim()) return;
  if (!options.endpoint?.trim()) {
    // Never let the browser choose a network-backed default voice.
    const voice = window.speechSynthesis?.getVoices().find((entry) => entry.localService && /^en/i.test(entry.lang));
    if (!voice) { options.onError?.("Select a local TTS endpoint in Session; no installed offline system voice is available"); return; }
    const utterance = new SpeechSynthesisUtterance(text); utterance.voice = voice; window.speechSynthesis.speak(utterance); return;
  }
  let base: string;
  try { base = assertLocalAiEndpoint(options.endpoint); } catch (error) { options.onError?.(error instanceof Error ? error.message : "Invalid local TTS endpoint"); return; }
  const key = `${base}:${options.voice ?? "af_heart"}`;
  if (!queue || queueKey !== key) {
    queue?.stop(); queueKey = key;
    queue = new LocalNarrationQueue({ synthesize: async (input, signal) => {
      const url = /\/audio\/speech$/.test(base) ? base : `${base}/audio/speech`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "kokoro", input, voice: options.voice || "af_heart", response_format: "wav", speed: 1 }), signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]), redirect: "error" });
      if (!response.ok) throw new Error(`Local speech synthesis failed (HTTP ${response.status})`);
      const audio = await response.blob(); if (!audio.size || (!audio.type.startsWith("audio/") && audio.type !== "application/octet-stream")) throw new Error("Local TTS returned no audio"); return audio;
    }, play: playBlob }, (message) => options.onError?.(message));
  }
  // Even a complete narration is broken into short speakable requests.
  for (const sentence of text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [text]) queue.enqueue(sentence.trim());
}
