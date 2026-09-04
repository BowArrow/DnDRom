import { describe, expect, it } from "vitest";
import { inspectTokenModel, MAX_TOKEN_MODEL_BYTES, mergeTokenAssetRevision } from "./tokenAssets";
import type { TokenAsset } from "../domain/types";

const glb = (size = 20): File => {
  const bytes = new Uint8Array(size);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, size, true);
  return new File([bytes], "mini.glb", { type: "model/gltf-binary" });
};

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
  return new File([bytes], "mini.glb", { type: "model/gltf-binary" });
};

describe("token model validation", () => {
  it("accepts a glTF 2.0 binary container", async () => {
    await expect(inspectTokenModel(glb())).resolves.toBeUndefined();
  });

  it("rejects renamed and malformed files", async () => {
    await expect(inspectTokenModel(new File([new Uint8Array(20)], "mini.glb"))).rejects.toThrow(/glTF 2.0/);
    await expect(inspectTokenModel(Object.assign(new Blob([new Uint8Array(20)]), { name: "mini.obj" }))).rejects.toThrow(/\.glb/);
  });

  it("enforces the documented model budget", async () => {
    const oversized = { name: "huge.glb", size: MAX_TOKEN_MODEL_BYTES + 1, slice: () => new Blob() } as unknown as Blob & { name: string };
    await expect(inspectTokenModel(oversized)).rejects.toThrow(/128 MB/);
  });

  it("rejects GLBs that depend on companion texture or buffer files", async () => {
    await expect(inspectTokenModel(documentGlb({ asset: { version: "2.0" }, images: [{ uri: "Textures/skin.png" }] }))).rejects.toThrow(/self-contained GLB/);
  });

  it("rejects triangle meshes above the 20,000-face gameplay budget", async () => {
    await expect(inspectTokenModel(documentGlb({
      asset: { version: "2.0" },
      accessors: [{ count: 60_003 }],
      meshes: [{ primitives: [{ mode: 4, indices: 0 }] }],
    }))).rejects.toThrow(/20,000 triangle faces/);
    await expect(inspectTokenModel(documentGlb({
      asset: { version: "2.0" },
      accessors: [{ count: 60_000 }],
      meshes: [{ primitives: [{ mode: 4, indices: 0 }] }],
    }))).resolves.toBeUndefined();
    await expect(inspectTokenModel(documentGlb({
      asset: { version: "2.0" },
      accessors: [{ count: 20_003 }],
      meshes: [{ primitives: [{ mode: 5, attributes: { POSITION: 0 } }] }],
    }))).rejects.toThrow(/20,000 triangle faces/);
  });

  it("keeps a saved character's catalogue identity and scenic-base assignments across revisions", () => {
    const previous: TokenAsset = { id: "frog", name: "Frog", kind: "player", storageKey: "sha256:old", filename: "frog.glb", byteLength: 20, footprint: .55, modelScale: 1, modelLift: .62, defaultPlacementScale: 1, base: { shape: "round", color: "#111111", accentColor: "#228844", height: .14 }, source: "import", createdAt: "first", gameplayAuthority: "mesh-token", defaultBasePlateAssetId: "pond", formBasePlateAssignments: { toad: "swamp" } };
    const created: TokenAsset = { ...previous, id: "replacement", storageKey: "sha256:new", filename: "frog-v2.glb", createdAt: "later", defaultBasePlateAssetId: undefined, formBasePlateAssignments: undefined };
    expect(mergeTokenAssetRevision(created, previous)).toMatchObject({ id: "frog", createdAt: "first", storageKey: "sha256:new", defaultBasePlateAssetId: "pond", formBasePlateAssignments: { toad: "swamp" } });
  });
});
