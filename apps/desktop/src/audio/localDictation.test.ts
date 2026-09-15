import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePcmWav, transcribeLocally } from "./localDictation";
describe("Private scene dictation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("encodes the 16 kHz mono PCM expected by whisper.cpp", async () => {
    const wav = encodePcmWav(new Float32Array([-1, 0, 1]));
    const bytes = await wav.arrayBuffer(), data = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getInt16(44, true)).toBe(-32768); expect(data.getInt16(48, true)).toBe(32767);
  });
  it("rejects remote transcription and redirects while supporting the local inference API", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ text: "A village in the forest" }))); vi.stubGlobal("fetch", fetch);
    await expect(transcribeLocally("https://speech.example", new Blob())).rejects.toThrow(/loopback/);
    expect(fetch).not.toHaveBeenCalled();
    expect(await transcribeLocally("http://127.0.0.1:8081", new Blob())).toBe("A village in the forest");
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8081/inference", expect.objectContaining({ redirect: "error", method: "POST" }));
  });
});
