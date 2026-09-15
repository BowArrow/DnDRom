// Development-only diagnostics. The release shortcut never enables this port.
export async function connectNative(port = 9338) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) })).json();
  const target = targets.find(value => value.type === "page" && value.url.startsWith("https://dndrom.local/"));
  if (!target) throw new Error("Native app page is not ready");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (request) { clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); } };
  socket.onclose = () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Native diagnostics disconnected")); } pending.clear(); };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; const timer = setTimeout(() => { pending.delete(next); reject(new Error(`${method} timed out`)); }, 30000); pending.set(next, { resolve, reject, timer }); socket.send(JSON.stringify({ id: next, method, params })); });
  return { call, close: () => socket.close(), evaluate: async expression => { const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; } };
}
