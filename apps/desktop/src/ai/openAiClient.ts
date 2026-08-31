interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export const assertLocalAiEndpoint = (endpoint: string): string => {
  const parsed = new URL(endpoint.trim());
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("Local AI only connects to a loopback endpoint (localhost, 127.0.0.1, or ::1)");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Local AI must use an HTTP endpoint");
  return parsed.toString().replace(/\/$/, "");
};

const normalizeEndpoint = (endpoint: string): string => assertLocalAiEndpoint(endpoint);

export async function completeLocalChat(options: ChatOptions): Promise<string> {
  const response = await fetch(`${normalizeEndpoint(options.endpoint)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
      stream: false,
      response_format: { type: "json_object" },
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Local AI returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Local AI returned no message content");
  return content;
}

export async function streamLocalChat(options: ChatOptions, onDelta: (delta: string, accumulated: string) => void): Promise<string> {
  const response = await fetch(`${normalizeEndpoint(options.endpoint)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
      stream: true,
      response_format: { type: "json_object" },
    }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Local AI returned ${response.status}: ${(await response.text().catch(() => "")).slice(0, 180)}`);
  if (!response.body) throw new Error("Local AI did not provide a response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = event.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          content += delta;
          onDelta(delta, content);
        }
      } catch {
        // Some compatible servers emit keepalive or metrics lines; they do not
        // carry model text and can be ignored safely.
      }
    }
    if (done) break;
  }
  if (!content) throw new Error("Local AI returned no message content");
  return content;
}

export function extractJson(value: string): unknown {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("AI response did not contain valid JSON");
  }
}

export async function testLocalAi(endpoint: string, model: string): Promise<{ latencyMs: number; response: string }> {
  const started = performance.now();
  const response = await completeLocalChat({
    endpoint,
    model,
    messages: [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: 'Return {"status":"ready"}.' },
    ],
    temperature: 0,
    maxTokens: 24,
  });
  return { latencyMs: Math.round(performance.now() - started), response };
}
