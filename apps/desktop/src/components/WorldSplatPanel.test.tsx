// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldSplatPanel } from "./WorldSplatPanel";

vi.mock("./SceneViewport", () => ({ SceneViewport: () => <div className="scene-viewport-test" /> }));

describe("Scenery Studio", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/system_stats")) return new Response("{}", { status: 200 });
      if (url.includes("/object_info/CheckpointLoaderSimple")) {
        return new Response(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["fantasy.safetensors"]] } } } }), { status: 200 });
      }
      if (url === "https://api.polyhaven.com/assets?t=hdris") {
        return new Response(JSON.stringify({ old_hall: { name: "Old Hall", description: "A lantern-lit hall", categories: ["indoor"], thumbnail_url: "https://cdn.polyhaven.com/hall.png" } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("opens with prompt generation and an integrated online panorama library", async () => {
    render(<WorldSplatPanel onNotify={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByLabelText("AI Gaussian scenery studio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prompt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Online library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Generate panorama \+ 3D world/i })).toBeTruthy();
    expect(screen.getByText(/No manual setup/i)).toBeTruthy();
    expect(screen.getByLabelText("Scene source settings")).toBeTruthy();
    expect(screen.getByLabelText("Scene 3D preview")).toBeTruthy();
    expect(screen.getByLabelText("Scene lighting settings")).toBeTruthy();
    expect(screen.getByText("Lighting engine")).toBeTruthy();
    expect(screen.getByText("HDRI / IBL")).toBeTruthy();
    expect(screen.getByText("Sun / moon key")).toBeTruthy();
    expect(screen.getByText("Fog of war")).toBeTruthy();
    expect(screen.getByText(/Forge stays fully visible/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Scene catalogue/i })).toBeTruthy();
    expect(screen.getByText("Playable region")).toBeTruthy();
    expect(screen.getByText("Biome")).toBeTruthy();
    expect(screen.getByText("Use current-adventure context")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create two world plans/i })).toBeTruthy();
    expect(screen.queryByText(/Test local forge/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Online library" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Old Hall/i })).toBeTruthy());
    expect(screen.getByText(/Free CC0 HDRIs/i)).toBeTruthy();
  });

  it("keeps context and refinement controls readable in narrow sidebars", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toContain('.world-context-toggle input[type="checkbox"]');
    expect(css).toMatch(/\.world-context-toggle span \{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.world-blueprint-details li \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.world-blueprint-details li small \{[^}]*white-space:\s*normal/s);
    expect(css).toMatch(/\.stage-status-bar \.splat-status \{[^}]*flex:\s*1 0 100%[^}]*white-space:\s*normal/s);
  });

  it("keeps publishing disabled until a reviewed procedural draft validates", () => {
    render(<WorldSplatPanel onNotify={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Publish base world/i })).toBeNull();
  });

  it("offers a real reconstruction retry when a prepared panorama job stops", async () => {
    const notify = vi.fn();
    const { container } = render(<WorldSplatPanel onNotify={notify} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    const input = container.querySelector<HTMLInputElement>('input[accept="image/png,image/jpeg,image/webp"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { files: [new File(["panorama"], "saved-panorama.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Build 3D world locally/i }));

    expect(await screen.findByRole("button", { name: /Retry failed stage/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry with reference quality/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue without background/i }).hasAttribute("disabled")).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/installed DnDRom desktop app/i), "error");
  });
});
