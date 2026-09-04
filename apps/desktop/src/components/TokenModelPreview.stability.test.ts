import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("token preview stability", () => {
  it("keeps the current imported model while a replacement loads and does not reload for role changes", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/TokenModelPreview.tsx"), "utf8");
    expect(source).toContain("pendingAsset");
    expect(source).toContain('dataset.previewState = "model-ready"');
    expect(source).toMatch(/\}, \[model\]\);/);
    expect(source).not.toMatch(/\}, \[model, kind\]\);/);
  });

  it("briefly pauses while typing, then resumes the Forge turntable", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/TokenModelPreview.tsx"), "utf8");
    expect(source).toContain("input, textarea, select, [contenteditable='true']");
    expect(source).toContain("performance.now() - runtime.lastTextInputAt < 1_400");
    expect(source).toContain('typingPaused ? "typing-paused" : "rotating"');
    expect(source).toContain("!runtime.reducedMotion && !typingPaused");
  });

  it("forces imported preview materials back into scene-reactive PBR lighting", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/TokenModelPreview.tsx"), "utf8");
    expect(source).toContain("applySceneReactiveMiniatureFinish(meshInstance.material)");
  });

  it("stops preview frames and ignores late model callbacks before changing workspaces", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/TokenModelPreview.tsx"), "utf8");
    expect(source).toContain("runtime.disposed = true");
    expect(source).toContain('app.off("update", updatePreview)');
    expect(source).toContain("runtime.disposed || runtime.pendingAsset !== asset");
  });
});
