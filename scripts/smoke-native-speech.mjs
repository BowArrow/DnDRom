import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const directory = path.join(root, "artifacts/native-speech-smoke"); await mkdir(directory, { recursive: true });
const host = spawn(path.join(root, "target/release/dndrom-runtime-host.exe"), ["--data-dir", directory, "--parent-pid", String(process.pid)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
let next = 0; const pending = new Map();
createInterface({ input: host.stdout }).on("line", line => { const message = JSON.parse(line); if (typeof message.ok === "boolean") { const callback = pending.get(message.id); if (callback) { pending.delete(message.id); message.ok ? callback.resolve(message.result) : callback.reject(new Error(message.error)); } } });
const request = (method, params = {}) => new Promise((resolve, reject) => { const id = `speech-${++next}`; pending.set(id, { resolve, reject }); host.stdin.write(JSON.stringify({ version: 1, id, method, params }) + "\n"); });
const timeout = setTimeout(() => host.kill(), 240_000);
const heartbeat = setInterval(() => console.log("Preparing and checking owned local speech runtime…"), 30_000);
try {
  const status = await request("runtime.ensure", { feature: "speech" });
  const sample = await fetch("https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.0/samples/jfk.wav");
  if (!sample.ok) throw new Error(`Speech fixture download failed: ${sample.status}`);
  const wav = await sample.arrayBuffer();
  const form = new FormData(); form.append("file", new Blob([wav], { type: "audio/wav" }), "jfk.wav"); form.append("response_format", "json"); form.append("language", "en");
  const start = performance.now();
  const response = await fetch(`${status.endpoint}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  
  const transcriptPassed = /ask not what your country can do for you/i.test((result.text ?? "").replace(/\s+/g," "));
  const report = { state: status.state, inferenceMilliseconds: performance.now() - start, transcriptPassed, source: "whisper.cpp v1.9.0 public JFK fixture", microphoneRecorded: false };
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (!transcriptPassed) throw new Error("Owned speech fixture transcription failed");
  await request("runtime.release");
} finally { clearTimeout(timeout); clearInterval(heartbeat); host.stdin.end(); setTimeout(() => { if (host.exitCode === null) host.kill(); }, 2000).unref(); }
