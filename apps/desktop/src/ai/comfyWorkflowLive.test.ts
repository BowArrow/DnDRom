import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { prepareCharacter3dWorkflow } from "./character3dClient";
import { configureCharacterPreset, configurePanoramaPreset, convertComfyUiWorkflow, type ComfyNodeDefinition, type ComfyUiWorkflow, type ComfyWorkflowPreset } from "./comfyWorkflowPreset";
import { preparePanoramaWorkflow } from "./splatKitClient";

const liveTest = process.env.DNDROM_COMFY_LIVE === "1" ? it : it.skip;

describe("live managed ComfyUI workflow validation", () => {
  it("applies the tabletop geometry budget to the actual bundled Pixal3D graph", async () => {
    const source = JSON.parse(await readFile(new URL("../../public/workflows/pixal3d-character.json", import.meta.url), "utf8")) as ComfyUiWorkflow;
    const configured = configureCharacterPreset(source, "pixal3d") as ComfyUiWorkflow;
    expect(configured.nodes.find((node) => node.id === 94)?.widgets_values?.[0]).toBe(1024);
    expect(configured.nodes.find((node) => node.id === 241)?.widgets_values).toMatchObject({ 0: 256, 8: 3, 10: 300_000 });
    expect(configured.nodes.find((node) => node.id === 186)?.widgets_values?.[0]).toBe(20_000);
    expect(configured.nodes.find((node) => node.id === 288)?.widgets_values?.[0]).toBe(2048);
    expect(configured.links.find((link) => link[0] === 1167)).toEqual([1167, 241, 0, 147, 2, "MESH"]);
    expect(configured.nodes.find((node) => node.id === 92)?.outputs?.[0].links).not.toContain(1167);
    expect(configured.nodes.find((node) => node.id === 241)?.outputs?.[0].links).toContain(1167);
  });

  liveTest("materializes the bundled Pixal3D graph with every required API input", async () => {
    const source = JSON.parse(await readFile(new URL("../../public/workflows/pixal3d-character.json", import.meta.url), "utf8")) as ComfyUiWorkflow;
    const response = await fetch("http://127.0.0.1:8189/object_info");
    expect(response.ok).toBe(true);
    const definitions = await response.json() as Record<string, ComfyNodeDefinition>;
    const readiness = convertComfyUiWorkflow(configureCharacterPreset(source, "pixal3d") as ComfyUiWorkflow, definitions);
    expect(readiness.missingNodes).toEqual([]);
    expect(readiness.workflow).not.toBeNull();
    expect(readiness.workflow?.["94"].inputs?.target_resolution).toBe(1024);
    expect(readiness.workflow?.["241"].inputs).toMatchObject({ resolution: 256, smooth_iters: 3, precluster_max_verts: 300_000 });
    expect(readiness.workflow?.["186"].inputs?.target_face_count).toBe(20_000);
    expect(readiness.workflow?.["147"].inputs).toMatchObject({ texture_size: ["288", 0], reference_mesh: ["241", 0] });
    expect(readiness.workflow?.["288"].inputs?.value).toBe(2048);
    const missingInputs: string[] = [];
    for (const [id, node] of Object.entries(readiness.workflow ?? {})) {
      for (const input of Object.keys(definitions[node.class_type ?? ""]?.input?.required ?? {})) {
        if (!(input in (node.inputs ?? {}))) missingInputs.push(`${id}:${node.class_type}.${input}`);
      }
    }
    expect(missingInputs, missingInputs.join("\n")).toEqual([]);
  });

  liveTest("accepts the bundled Pixal3D prompt before expensive generation starts", async () => {
    const source = JSON.parse(await readFile(new URL("../../public/workflows/pixal3d-character.json", import.meta.url), "utf8")) as ComfyUiWorkflow;
    const definitions = await (await fetch("http://127.0.0.1:8189/object_info")).json() as Record<string, ComfyNodeDefinition>;
    const readiness = convertComfyUiWorkflow(configureCharacterPreset(source, "pixal3d") as ComfyUiWorkflow, definitions);
    expect(readiness.workflow).not.toBeNull();
    const image = new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], "dndrom-live-check.png", { type: "image/png" });
    const form = new FormData();
    form.append("image", image);
    form.append("type", "input");
    form.append("overwrite", "true");
    const upload = await (await fetch("http://127.0.0.1:8189/upload/image", { method: "POST", body: form })).json() as { name: string; subfolder?: string };
    const prompt = prepareCharacter3dWorkflow(readiness.workflow!, upload, { provider: "pixal3d", targetFaces: 20_000 });
    const response = await fetch("http://127.0.0.1:8189/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, client_id: crypto.randomUUID() }) });
    const result = await response.json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
    if (result.prompt_id) {
      await fetch("http://127.0.0.1:8189/interrupt", { method: "POST" });
      await fetch("http://127.0.0.1:8189/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [result.prompt_id] }) });
    }
    expect(response.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.prompt_id, JSON.stringify(result, null, 2)).toBeTypeOf("string");
  });

  liveTest("materializes both bundled world workflows with complete required inputs", async () => {
    const definitions = await (await fetch("http://127.0.0.1:8189/object_info")).json() as Record<string, ComfyNodeDefinition>;
    for (const filename of ["splatkit-panorama.json", "splatkit-dataset.json"]) {
      const source = JSON.parse(await readFile(new URL(`../../public/workflows/${filename}`, import.meta.url), "utf8")) as ComfyWorkflowPreset;
      const configured = filename.includes("panorama") ? configurePanoramaPreset(source) : source;
      const readiness = convertComfyUiWorkflow(configured as ComfyUiWorkflow, definitions);
      expect(readiness.missingNodes, filename).toEqual([]);
      expect(readiness.workflow, filename).not.toBeNull();
      const missingInputs: string[] = [];
      for (const [id, node] of Object.entries(readiness.workflow ?? {})) {
        for (const input of Object.keys(definitions[node.class_type ?? ""]?.input?.required ?? {})) {
          if (!(input in (node.inputs ?? {}))) missingInputs.push(`${id}:${node.class_type}.${input}`);
        }
      }
      expect(missingInputs, `${filename}\n${missingInputs.join("\n")}`).toEqual([]);
    }
  });

  liveTest("accepts the bundled prompt-to-panorama graph before generation starts", async () => {
    const definitions = await (await fetch("http://127.0.0.1:8189/object_info")).json() as Record<string, ComfyNodeDefinition>;
    const source = JSON.parse(await readFile(new URL("../../public/workflows/splatkit-panorama.json", import.meta.url), "utf8")) as ComfyUiWorkflow;
    const readiness = convertComfyUiWorkflow(configurePanoramaPreset(source) as ComfyUiWorkflow, definitions);
    expect(readiness.workflow).not.toBeNull();
    const prompt = preparePanoramaWorkflow(readiness.workflow!, "A moonlit harbor with lantern reflections, seamless 360 panorama");
    const response = await fetch("http://127.0.0.1:8189/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, client_id: crypto.randomUUID() }) });
    const result = await response.json() as { prompt_id?: string; error?: unknown; node_errors?: unknown };
    if (result.prompt_id) {
      await fetch("http://127.0.0.1:8189/interrupt", { method: "POST" });
      await fetch("http://127.0.0.1:8189/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [result.prompt_id] }) });
    }
    expect(response.ok, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.prompt_id, JSON.stringify(result, null, 2)).toBeTypeOf("string");
  });
});
