// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rgb = (value: string): [number, number, number] => {
  const parts = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (parts.length !== 3) throw new Error(`Expected an RGB color, received ${value}`);
  return parts as [number, number, number];
};

const luminance = (value: string): number => rgb(value)
  .map((channel) => channel / 255)
  .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);

const contrast = (foreground: string, background: string): number => {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
};

describe("asset launcher readability", () => {
  it("keeps every Forge and catalogue launcher on the shared high-contrast card style", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "src/components/AssetPalette.tsx"), "utf8");
    const selectors = ["prop-studio-button", "prop-library-button", "material-library-button"];
    selectors.forEach((selector) => expect(source).toContain(`creator-launch-button ${selector}`));

    const rules = [
      css.match(/\.creator-launch-button\s*\{[^}]+\}/)?.[0],
      css.match(/body \.app-shell \.creator-launch-button strong\s*\{[^}]+\}/)?.[0],
      css.match(/body \.app-shell \.creator-launch-button small\s*\{[^}]+\}/)?.[0],
    ];
    expect(rules.every(Boolean)).toBe(true);
    const style = document.createElement("style");
    style.textContent = rules.join("\n");
    document.head.append(style);
    document.body.innerHTML = '<div class="app-shell"><button class="creator-launch-button prop-studio-button"><span><strong>Prop Forge</strong><small>Create reviewed props</small></span></button></div>';
    const button = document.querySelector("button")!;
    const background = getComputedStyle(button).backgroundColor;
    expect(contrast(getComputedStyle(button.querySelector("strong")!).color, background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(getComputedStyle(button.querySelector("small")!).color, background)).toBeGreaterThanOrEqual(4.5);
  });
});
