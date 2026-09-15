// Read/evaluate the explicitly enabled development browser diagnostics endpoint.
import { writeFile } from "node:fs/promises";
const targets = await (await fetch("http://127.0.0.1:9338/json")).json();
const target = targets.find(value => value.type === "page");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0; const pending = new Map();
socket.onmessage = event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
const call = (method, params) => new Promise(resolve => { const next = ++id; pending.set(next, resolve); socket.send(JSON.stringify({ id: next, method, params })); });
const expression = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "({text:document.body.innerText.slice(0,3000),bridge:!!window.ue?.dndrom,viewport:document.querySelector('.native-scene-viewport')?.getBoundingClientRect().toJSON()})";
console.log(JSON.stringify(await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), null, 2));
if (process.argv.includes("--capture")) { const result = await call("Page.captureScreenshot", { format: "png" }); await writeFile("artifacts/native-ui.png", Buffer.from(result.result.data, "base64")); }
socket.close();
