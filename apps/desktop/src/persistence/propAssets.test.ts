import { describe, expect, it } from "vitest";
import { inspectPropModel, MAX_PROP_TRIANGLES } from "./propAssets";

const documentGlb = (document: object): File => {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + paddedLength);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  return new File([bytes], "prop.glb", { type: "model/gltf-binary" });
};

const boundedProp = (indexCount = 24) => documentGlb({
  asset: { version: "2.0" },
  accessors: [
    { count: 8, min: [-1, -.25, -2], max: [1, 1.75, 2] },
    { count: indexCount },
  ],
  meshes: [{ primitives: [{ mode: 4, indices: 1, attributes: { POSITION: 0 } }] }],
});

describe("prop GLB validation", () => {
  it("extracts authored bounds and triangle count for grounding", async () => {
    await expect(inspectPropModel(boundedProp())).resolves.toEqual({
      triangleCount: 8,
      bounds: { min: { x: -1, y: -.25, z: -2 }, max: { x: 1, y: 1.75, z: 2 } },
    });
  });

  it("enforces the 20,000-triangle gameplay ceiling", async () => {
    await expect(inspectPropModel(boundedProp(MAX_PROP_TRIANGLES * 3))).resolves.toMatchObject({ triangleCount: MAX_PROP_TRIANGLES });
    await expect(inspectPropModel(boundedProp(MAX_PROP_TRIANGLES * 3 + 3))).rejects.toThrow(/20,000 triangles/);
  });

  it("rejects GLBs with external binary or texture dependencies", async () => {
    const external = documentGlb({
      asset: { version: "2.0" },
      buffers: [{ uri: "prop.bin" }],
      images: [{ uri: "paint.png" }],
      accessors: [{ count: 3, min: [0, 0, 0], max: [1, 1, 1] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    });
    await expect(inspectPropModel(external)).rejects.toThrow(/embed every texture and buffer/);
  });
});
