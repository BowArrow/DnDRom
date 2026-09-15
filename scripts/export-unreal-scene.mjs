import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const { build } = require("esbuild");
const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error("Usage: pnpm unreal:export <campaign.dndrom or map.json> <scene.dndscene>"); process.exit(1); }
const temporary = await mkdtemp(path.join(os.tmpdir(), "dndrom-unreal-export-"));
try {
  const bundled = path.join(temporary, "export.mjs");
  await build({ entryPoints: [path.join(root, "apps/desktop/src/migration/unrealScene.ts")], outfile: bundled, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning" });
  const { exportUnrealScene } = await import(pathToFileURL(bundled).href);
  const source = JSON.parse(await readFile(input, "utf8"));
  const map = source.map ?? source;
  if (!Array.isArray(map.entities) || typeof map.name !== "string") throw new Error("Input must be a DnDRom map or campaign");
  const scene = exportUnrealScene(map, source.map ? source : undefined);
  const encoded = JSON.stringify(scene);
  if (Buffer.byteLength(encoded) > 128 * 1024 * 1024) throw new Error("Export exceeds the Unreal preview's 128 MiB import budget; use fewer resident regions");
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, encoded);
  console.log(JSON.stringify({ file: path.resolve(output), meshGroups: scene.meshes.length, instances: scene.instances.length, compatibilityNotices: scene.warnings.length, bytes: Buffer.byteLength(encoded) }, null, 2));
} finally {
  // The directory is the exact mkdtemp result owned by this invocation.
  await rm(temporary, { recursive: true, force: true });
}
