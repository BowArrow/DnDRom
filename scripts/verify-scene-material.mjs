// Exercise the actual bundled workflow against an already-running local ComfyUI.
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = path.resolve(import.meta.dirname, ".."), require = createRequire(path.join(root, "apps/desktop/package.json"));
const { build } = require("esbuild"), output = path.join(root, "artifacts/scene-material-live.mjs");
await mkdir(path.dirname(output), { recursive: true });
await build({ stdin: { contents: 'export { generateLocalPropCandidate } from "./apps/desktop/src/ai/propImageClient"; export { compileMaterialPrompt } from "./apps/desktop/src/ai/propPrompt";', resolveDir: root }, outfile: output, bundle: true, platform: "node", format: "esm" });
const { generateLocalPropCandidate, compileMaterialPrompt } = await import(pathToFileURL(output));
globalThis.window = { setTimeout, clearTimeout, localStorage: { getItem: () => null } };
const workflow = JSON.parse(await readFile(path.join(root, "apps/desktop/public/workflows/prop-sana-reference.json"), "utf8"));
const started = Date.now();
const image = await generateLocalPropCandidate(process.env.DNDROM_COMFY_ENDPOINT || "http://127.0.0.1:8189", compileMaterialPrompt("Small repeating rows of weathered jade green glazed ceramic tiles, delicate blue-green glaze and subtle ochre wear, evenly spaced horizontal ceramic ridges", "general"), workflow, 0, AbortSignal.timeout(600_000), (event) => console.log(JSON.stringify(event)), undefined, true);
await writeFile(path.join(root, "artifacts/scene-material-jade.png"), Buffer.from(await image.arrayBuffer()));
console.log(JSON.stringify({ elapsedSeconds: (Date.now() - started) / 1000, bytes: image.size, type: image.type }));
