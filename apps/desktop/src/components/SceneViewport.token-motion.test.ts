import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("tabletop character motion policy", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/SceneViewport.tsx"), "utf8");

  it("never rotates a placed miniature with synthetic procedural motion", () => {
    expect(source).not.toContain("setLocalEulerAngles(transform.pitch, transform.yaw, transform.roll)");
    expect(source).not.toMatch(/import \{[^}]*tokenMotionAt[^}]*\} from "\.\.\/domain\/tokenAnimation"/);
    expect(source).toContain('canvas.dataset.proceduralMotionFallback = "disabled"');
    expect(source).toContain('canvas.dataset.syntheticTokenRotation = "0"');
    expect(source).toContain('canvas.dataset.tokenRotationPolicy = "placed-facing-or-embedded-skeleton"');
  });

  it("plays motion only when the loaded character contains the requested skeletal state", () => {
    expect(source).toContain('animComponent?.baseLayer?.states.includes(animation.id)');
    expect(source).toContain('animComponent.baseLayer.play(animation.id)');
    expect(source).toContain('canvas.dataset.tokenAnimationRuntime = "embedded-glb-skeletal-only-static-without-clip"');
  });
});
