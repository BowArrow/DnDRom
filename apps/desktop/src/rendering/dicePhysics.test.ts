import { describe, expect, it } from "vitest";
import { simulateDicePhysics, type DicePhysicsInput } from "./dicePhysics";

const cube: DicePhysicsInput = {
  vertices: [
    { x: -.55, y: -.55, z: -.55 }, { x: .55, y: -.55, z: -.55 },
    { x: .55, y: .55, z: -.55 }, { x: -.55, y: .55, z: -.55 },
    { x: -.55, y: -.55, z: .55 }, { x: .55, y: -.55, z: .55 },
    { x: .55, y: .55, z: .55 }, { x: -.55, y: .55, z: .55 },
  ],
  faces: [[3, 2, 1, 0], [4, 5, 6, 7], [7, 6, 2, 3], [0, 1, 5, 4], [1, 2, 6, 5], [4, 7, 3, 0]],
  spawn: { x: 7, y: 2.4, z: 0 },
  landingHint: { x: 0, y: .7, z: 0 },
};

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = seed + 0x6D2B79F5 | 0;
  let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
  value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
  return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
};

describe("Rapier dice physics", () => {
  it("produces a colliding rigid-body toss and a valid naturally landed face", async () => {
    const [result] = await simulateDicePhysics([cube], { width: 18, depth: 14 }, seeded(41));
    const first = result.frames[0];
    const middle = result.frames[Math.floor(result.frames.length / 2)];
    const last = result.frames[result.frames.length - 1];
    expect(result.frames.length).toBeGreaterThan(45);
    expect(middle.position.x).toBeLessThan(first.position.x);
    expect(middle.rotation).not.toEqual(first.rotation);
    expect(last.position.y).toBeGreaterThan(.45);
    expect(last.position.y).toBeLessThan(.9);
    expect(result.topFaceIndex).toBeGreaterThanOrEqual(0);
    expect(result.topFaceIndex).toBeLessThan(cube.faces.length);
  });

  it("changes the physical trajectory when the toss impulse changes", async () => {
    const [left] = await simulateDicePhysics([cube], { width: 18, depth: 14 }, seeded(9));
    const [right] = await simulateDicePhysics([cube], { width: 18, depth: 14 }, seeded(91));
    const leftSample = left.frames[Math.min(40, left.frames.length - 1)];
    const rightSample = right.frames[Math.min(40, right.frames.length - 1)];
    expect(leftSample.rotation).not.toEqual(rightSample.rotation);
    expect(leftSample.position).not.toEqual(rightSample.position);
  });
});
