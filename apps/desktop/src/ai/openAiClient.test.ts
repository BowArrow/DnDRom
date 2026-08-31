import { describe, expect, it } from "vitest";
import { assertLocalAiEndpoint } from "./openAiClient";

describe("local AI endpoint boundary", () => {
  it("allows loopback runtimes and rejects hosted inference", () => {
    expect(assertLocalAiEndpoint("http://localhost:8080/v1/")).toBe("http://localhost:8080/v1");
    expect(assertLocalAiEndpoint("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
    expect(() => assertLocalAiEndpoint("https://api.example.com/v1")).toThrow(/loopback/);
  });
});
