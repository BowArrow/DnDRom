import { describe, expect, it } from "vitest";
import { parseNativeGlb } from "./nativeGlb";

function fixture(options: { mirrored?: boolean; truncated?: boolean; sparse?: boolean } = {}) {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0]);
  const doc = { asset: { version: "2.0" }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: options.truncated ? 8 : 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", ...(options.sparse ? { sparse: {} } : {}) }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [.5, .25, 1, 1], metallicFactor: 0, roughnessFactor: .7 } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], nodes: [{ mesh: 0, translation: [3, 4, 5], scale: [options.mirrored ? -1 : 1, 1, 1] }], scenes: [{ nodes: [0] }] };
  const json = new TextEncoder().encode(JSON.stringify(doc)); const length = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(12 + 8 + length + 8 + positions.byteLength), view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); new Uint8Array(bytes, 20, length).fill(32); new Uint8Array(bytes, 20, json.length).set(json);
  view.setUint32(20 + length, positions.byteLength, true); view.setUint32(24 + length, 0x004e4942, true); new Uint8Array(bytes, 28 + length).set(new Uint8Array(positions.buffer));
  return bytes;
}
describe("native GLB import", () => {
  it("includes an assigned scenic surface at ground level and preserves legacy mesh proportions without scaling its height separately",()=>{
    const parsed=parseNativeGlb({bytes:fixture(),ground:.168,scenicBase:{bytes:fixture(),id:'base',diameter:1.1,heightRatio:.1}},'token');
    expect(parsed.parts).toHaveLength(2);expect(parsed.materials).toHaveLength(2);
    const base=parsed.parts[1].geometry.positions,ys=base.filter((_,i)=>i%3===1);expect(Math.min(...ys)).toBeCloseTo(0);expect(Math.max(...ys)).toBeCloseTo(.539);
    expect(parsed.parts[0].geometry.positions[1]).toBeCloseTo(.002);
  });
  it("preserves node transforms, linear base color and material roughness", () => {
    const model = parseNativeGlb({ bytes: fixture() }, "prop-1");
    expect(model.parts[0].geometry.positions.slice(0, 6)).toEqual([3, 4, 5, 5, 4, 5]);
    expect(model.parts[0].geometry.colors.slice(0, 4)).toEqual([128, 64, 255, 255]);
    expect(model.materials[0]).toMatchObject({ roughness: .7, metallic: 0 });
  });
  it("corrects reflected winding and grounds scaled miniatures on their base", () => {
    const model = parseNativeGlb({ bytes: fixture({ mirrored: true }), scale: 2, ground: .2 }, "mini-1");
    expect(model.parts[0].geometry.indices).toEqual([0, 2, 1]);
    expect(model.parts[0].geometry.positions[1]).toBeCloseTo(.2);
    expect(model.parts[0].geometry.normals[2]).toBeGreaterThan(.99);
  });
  it("rejects out-of-range and unsupported sparse accessors before rendering", () => {
    expect(() => parseNativeGlb({ bytes: fixture({ truncated: true }) }, "bad")).toThrow("out of bounds");
    expect(() => parseNativeGlb({ bytes: fixture({ sparse: true }) }, "bad")).toThrow("Unsupported");
  });
});

it('includes the ordinary miniature plinth and rim when no scenic mesh is assigned',()=>{
 const model=parseNativeGlb({bytes:fixture(),ground:.168,tokenBase:{shape:'hex',diameter:1.1,height:.14,color:'#222222',rimColor:'#ccaaff'}},'token');
 expect(model.parts).toHaveLength(3);const vertices=model.parts[1].geometry.positions;
 expect(Math.min(...vertices.filter((_,i)=>i%3===1))).toBeCloseTo(0);expect(Math.max(...vertices.filter((_,i)=>i%3===1))).toBeCloseTo(.14);
 expect(model.parts[2].geometry.colors.slice(0,4)).toEqual([204,170,255,255]);
});
