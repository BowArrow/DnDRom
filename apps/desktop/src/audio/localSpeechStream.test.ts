import { describe, expect, it, vi } from "vitest";
import { SpeechChunker, type SpeechChunk } from "./localSpeechStream";
import { LocalNarrationQueue, type SpeechPlayback } from "./localNarration";

describe("Local streaming conversation", () => {
  it("emits partial audio while speaking and submits only after an utterance ends", () => {
    const chunks: SpeechChunk[] = [], start = vi.fn();
    const chunker = new SpeechChunker((chunk) => chunks.push(chunk), start);
    for (let i = 0; i < 14; i++) chunker.push(new Float32Array(1600).fill(.1));
    expect(start).toHaveBeenCalledTimes(1);
    expect(chunks.some((chunk) => !chunk.finalSegment)).toBe(true);
    expect(chunks.some((chunk) => chunk.finalUtterance)).toBe(false);
    for (let i = 0; i < 6; i++) chunker.push(new Float32Array(1600));
    expect(chunks.at(-1)?.finalUtterance).toBe(true);
    expect(chunks.at(-1)?.samples.length).toBeLessThan(16000 * 3);
  });
  it("bounds long speech segments and ignores background silence", () => {
    const chunks: SpeechChunk[] = [], start = vi.fn();
    const chunker = new SpeechChunker((chunk) => chunks.push(chunk), start);
    for (let i = 0; i < 100; i++) chunker.push(new Float32Array(1600));
    expect(chunks).toHaveLength(0);
    for (let i = 0; i < 170; i++) chunker.push(new Float32Array(1600).fill(.1));
    chunker.finish();
    expect(chunks.filter((chunk) => chunk.finalSegment)).toHaveLength(3);
    expect(chunks.filter((chunk) => chunk.finalUtterance)).toHaveLength(1);
    expect(Math.max(...chunks.map((chunk) => chunk.samples.length))).toBeLessThanOrEqual(16000 * 8.1);
  });
  it("synthesizes the next sentence during playback and cancels queued audio on interruption", async () => {
    const finish: Array<() => void> = [], signals: AbortSignal[] = [];
    const synthesize = vi.fn(async (text: string, signal: AbortSignal) => { signals.push(signal); return new Blob([text]); });
    const stops: ReturnType<typeof vi.fn>[] = [];
    const play = vi.fn((_blob: Blob): SpeechPlayback => {
      let resolve!: () => void;
      const done = new Promise<void>((r) => { resolve = r; finish.push(r); });
      const stop = vi.fn(() => resolve()); stops.push(stop); return { done, stop };
    });
    const queue = new LocalNarrationQueue({ synthesize, play });
    queue.enqueue("First sentence."); queue.enqueue("Second sentence.");
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    expect(play).toHaveBeenCalledTimes(1);
    queue.stop();
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(play).toHaveBeenCalledTimes(1);
    queue.enqueue("A new turn.");
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    finish.at(-1)!(); queue.stop();
  });
  it("closes an utterance stopped exactly at the eight-second segment boundary", () => {
    const chunks: SpeechChunk[] = [];
    const chunker = new SpeechChunker((chunk) => chunks.push(chunk), () => {});
    for (let i = 0; i < 80; i++) chunker.push(new Float32Array(1600).fill(.1));
    chunker.finish();
    expect(chunks.at(-1)).toMatchObject({ finalSegment: true, finalUtterance: true });
    expect(chunks.at(-1)?.samples.length).toBe(0);
  });
});
