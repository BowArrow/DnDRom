import { describe, expect, it, vi } from "vitest";
import { assertLocalAiEndpoint, completeLocalChat } from "./openAiClient";

describe("local AI endpoint boundary", () => {
  it('decodes split streamed JSON while reporting activity without exposing reasoning',async()=>{
    const encoded=new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\ndata: {"choices":[{"delta":{"content":"{\\"name\\":\\"港\\"}"}}]}\n\ndata: [DONE]');
    const stream=new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=3)controller.enqueue(encoded.slice(i,i+3));controller.close();}});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(stream,{headers:{'content-type':'text/event-stream'}})));
    const progress=vi.fn();
    try{expect(await completeLocalChat({endpoint:'http://localhost:8080/v1',model:'local',messages:[],onProgress:progress})).toBe('{"name":"港"}');expect(progress).toHaveBeenCalled();expect(progress.mock.calls.every(([value])=>typeof value==='number')).toBe(true);}
    finally{vi.unstubAllGlobals();}
  });
  it('shares one cancellation deadline across response-format retries',async()=>{
    const signals:AbortSignal[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{signals.push(options.signal);return signals.length===1?new Response('',{status:400}):new Response('{"choices":[{"message":{"content":"{}"}}]}');}));
    try{await completeLocalChat({endpoint:'http://localhost:8080/v1',model:'local',messages:[],timeoutMs:5000});expect(signals[0]).toBe(signals[1]);}
    finally{vi.unstubAllGlobals();}
  });
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
