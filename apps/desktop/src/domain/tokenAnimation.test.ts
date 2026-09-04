import { describe, expect, it } from "vitest";
import { compileTokenAnimation, normalizeTokenAnimation, resolveTokenState, tokenMotionAt } from "./tokenAnimation";
import type { TokenAsset } from "./types";

describe("token animation profiles", () => {
  it("compiles player language into deterministic tabletop motion", () => {
    expect(compileTokenAnimation("Leap forward and slash with both claws", "attack").motion).toBe("slash");
    expect(compileTokenAnimation("Float gently while waiting", "idle").motion).toBe("hover");
  });

  it("returns to neutral after a one-shot attack", () => {
    const animation = compileTokenAnimation("slam the hammer", "attack");
    expect(tokenMotionAt(animation, animation.duration + .1).complete).toBe(true);
    expect(tokenMotionAt(animation, animation.duration + .1).scale).toBe(1);
  });

  it("repairs a stale spinning profile without changing authored skeletal clips", () => {
    const stale = { ...compileTokenAnimation("Breathe gently while standing ready", "idle"), motion: "burst" as const };
    expect(normalizeTokenAnimation(stale).motion).toBe("breathe");
    expect(normalizeTokenAnimation({ ...stale, source: "hy-motion" }).motion).toBe("burst");
  });

  it("provides a backward-compatible default form", () => {
    const token = { id: "token-a", name: "A", kind: "player", storageKey: "sha256:a", filename: "a.glb", byteLength: 20, footprint: .5, modelScale: 1, modelLift: .6, defaultPlacementScale: 1, base: { shape: "round", color: "#000", accentColor: "#fff", height: .14 }, source: "import", createdAt: "now", gameplayAuthority: "mesh-token" } satisfies TokenAsset;
    expect(resolveTokenState(token).storageKey).toBe("sha256:a");
  });

  it("resolves an independently selected shapeshift form and its own motions", () => {
    const idle = compileTokenAnimation("Hover in a spectral wolf stance", "idle", { id: "wolf-idle" });
    const token = {
      id: "token-shifter", name: "Shifter", kind: "player", storageKey: "sha256:hero", filename: "hero.glb", byteLength: 20, footprint: .5, modelScale: 1, modelLift: .6, defaultPlacementScale: 1,
      base: { shape: "round", color: "#000", accentColor: "#fff", height: .14 }, source: "import", createdAt: "now", gameplayAuthority: "mesh-token", defaultStateId: "hero",
      states: [
        { id: "hero", name: "Hero", storageKey: "sha256:hero", filename: "hero.glb", byteLength: 20, modelScale: 1, modelLift: .6, animations: [], createdAt: "now" },
        { id: "wolf", name: "Dire wolf", storageKey: "sha256:wolf", filename: "wolf.glb", byteLength: 24, modelScale: 1.2, modelLift: .6, animations: [idle], createdAt: "now" },
      ],
    } satisfies TokenAsset;
    expect(resolveTokenState(token, "wolf")).toMatchObject({ name: "Dire wolf", animations: [{ id: "wolf-idle", motion: "hover" }] });
    expect(resolveTokenState(token, "missing").id).toBe("hero");
  });
});
