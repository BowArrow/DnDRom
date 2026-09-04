import { describe, expect, it, vi } from "vitest";
import { assertLocalAiEndpoint, completeLocalChat } from "./openAiClient";

describe("local AI endpoint boundary", () => {
  it("allows loopback runtimes and rejects hosted inference", () => {
    expect(assertLocalAiEndpoint("http://localhost:8080/v1/")).toBe("http://localhost:8080/v1");
    expect(assertLocalAiEndpoint("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
    expect(() => assertLocalAiEndpoint("https://api.example.com/v1")).toThrow(/loopback/);
  });

  it("retries a local server that rejects the optional JSON response format", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported response_format", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"status":"ready"}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(completeLocalChat({ endpoint: "http://127.0.0.1:8080/v1", model: "local", messages: [{ role: "user", content: "status" }] })).resolves.toBe('{"status":"ready"}');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toHaveProperty("response_format");
      expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).not.toHaveProperty("response_format");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
