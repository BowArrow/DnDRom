import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("shared PlayCanvas context", () => {
  it("reuses detached canvases without moving a live WebGPU context", () => {
    const lifecycle = readFileSync(resolve(process.cwd(), "src/rendering/sharedPlayCanvas.ts"), "utf8");
    expect(lifecycle).toContain("let sharedCanvas: HTMLCanvasElement | null = null");
    expect(lifecycle).toContain("sharedCanvas && !sharedCanvas.isConnected");
    expect(lifecycle).toContain("host.replaceChildren(canvas)");
    for (const file of ["SceneViewport.tsx", "TokenModelPreview.tsx", "DiceThemePreview.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), `src/components/${file}`), "utf8");
      expect(source).toContain("claimSharedPlayCanvas");
      expect(source).toContain("releaseSharedPlayCanvas");
    }
  });
});
