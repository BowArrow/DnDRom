interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

interface ChatOptions {
  endpoint: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  responseSchema?: Record<string, unknown>;
  onProgress?: (characters: number) => void;
  timeoutMs?: number;
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
  const url = `${normalizeEndpoint(options.endpoint)}/chat/completions`;
  const signal = options.timeoutMs ? AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs)]) : options.signal;
  const body = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
      stream: Boolean(options.onProgress),
  };
  const request = (jsonMode: boolean) => fetch(url, {
    redirect: "error",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonMode ? { ...body, response_format: options.responseSchema ? { type: "json_schema", json_schema: { name: "dndrom_response", strict: true, schema: options.responseSchema } } : { type: "json_object" } } : body),
    signal,
  });
  let response = await request(true);
  // Several otherwise OpenAI-compatible local engines reject response_format.
  // The system prompt already requires JSON, so retry once without that optional
  // field instead of breaking contextual baseplate suggestions with HTTP 400.
  if (response.status === 400 && !options.signal?.aborted) response = await request(false);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Local AI returned ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  if(options.onProgress&&response.headers.get('content-type')?.includes('text/event-stream')){
    if(!response.body)throw new Error('Local AI returned no response stream');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='',characters=0,finished=false;
    const consume=(line:string)=>{if(!line.startsWith('data:'))return;const data=line.slice(5).trim();if(data==='[DONE]'){finished=true;return;}if(!data)return;let event;try{event=JSON.parse(data);}catch{return;}const delta=event.choices?.[0]?.delta;if(typeof delta?.content==='string')content+=delta.content;characters+=(delta?.content?.length??0)+(delta?.reasoning_content?.length??0);options.onProgress!(characters);};
    try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});if(buffer.length+content.length>2_000_000)throw new Error('Local AI response exceeded the planning limit');const lines=buffer.split(/\r?\n/);buffer=lines.pop()??'';for(const line of lines)consume(line);if(done){consume(buffer);break;}if(finished)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(!content)throw new Error('Local AI returned no message content');return content;
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
    redirect: "error",
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
