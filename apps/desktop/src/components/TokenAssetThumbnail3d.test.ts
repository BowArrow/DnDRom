import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("miniature thumbnail rendering budget", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/TokenAssetThumbnail3d.tsx"), "utf8");

  it("uses stored artwork instead of allocating catalogue WebGL contexts", () => {
    expect(source).toContain("token.sourceImage ?? token.originalSourceImage");
    expect(source).toContain("getStoredTokenModel(source.storageKey)");
    expect(source).toContain("toThumbnailDataUrl");
    expect(source).toContain('canvas.toDataURL("image/png")');
    expect(source).toContain('data-render-policy="stored-source-image"');
    expect(source).not.toContain('from "playcanvas"');
    expect(source).not.toContain("new pc.Application(");
  });

  it("keeps imported-model entries visible when source art is unavailable", () => {
    expect(source).toContain("fallbackThumbnail(token)");
    expect(source).toContain('data-preview-source={source ? "character-art" : "catalogue-fallback"}');
  });
});
