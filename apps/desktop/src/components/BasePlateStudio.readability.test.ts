// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const channels = (value: string): [number, number, number] => {
  const result = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (result.length !== 3) throw new Error(`Expected RGB color, received ${value}`);
  return result as [number, number, number];
};
const luminance = (value: string) => channels(value).map((part) => part / 255).map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4).reduce((sum, part, index) => sum + part * [.2126, .7152, .0722][index], 0);
const contrast = (foreground: string, background: string) => { const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); };

describe("scenic baseplate controls", () => {
  it("keeps selected concept text readable on an explicitly dark surface", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const rules = css.match(/\.baseplate-concepts[^{}]+\{[^}]+\}/g) ?? [];
    const style = document.createElement("style"); style.textContent = rules.join("\n"); document.head.append(style);
    document.body.innerHTML = '<div class="baseplate-concepts"><button class="active"><span></span><strong>Concept 1</strong><small>Generated image ready</small></button></div>';
    const button = document.querySelector("button")!;
    const background = getComputedStyle(button).backgroundColor;
    expect(contrast(getComputedStyle(button.querySelector("strong")!).color, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(getComputedStyle(button.querySelector("small")!).color, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("exposes working order and remove controls plus reviewed image-to-3D", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/BasePlateStudio.tsx"), "utf8");
    expect(source).toContain("reorderBasePlateLayer(value, layerId, direction)");
    expect(source).toContain("removeBasePlateLayer(value, layerId)");
    expect(source).toContain("Create scenic base in 3D");
    expect(source).toContain("generateBasePlateGlb");
    expect(source).toContain("Approve this image");
    expect(source).not.toContain("addLayer(\"decoration\")");
    expect(source).not.toContain("addLayer(\"effect\")");
    expect(source.match(/className="baseplate-layer-list/g)).toHaveLength(1);
    expect(source).toContain("disabled={!hasGeneratedMesh}");
  });

  it("uses the shared searchable preview catalogue instead of an inline asset list", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/BasePlateStudio.tsx"), "utf8");
    expect(source).toContain("Baseplate catalogue");
    expect(source).toContain("AssetCatalogueDialog");
    expect(source).toContain("BasePlateAssetPreview");
    expect(source).toContain("Open in editor");
    expect(source).toContain("Use for this character");
    expect(source).not.toContain("className=\"baseplate-catalogue\"");
  });

  it("never falls back to pale browser buttons for disabled base controls", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.baseplate-layer-list \.layer-order:disabled[^}]+background:#14110d !important[^}]+color:#76694f !important/);
    expect(contrast("rgb(118, 105, 79)", "rgb(20, 17, 13)")).toBeGreaterThanOrEqual(3);
  });
});
