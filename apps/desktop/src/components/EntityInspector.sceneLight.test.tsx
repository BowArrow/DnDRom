// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MapEntity } from "../domain/types";
import { EntityInspector } from "./EntityInspector";

describe("scene light inspector", () => {
  it("exposes readable per-instance controls for a build-only light", () => {
    const entity: MapEntity = {
      id: "scene-light",
      assetId: "scene-light-spot",
      name: "Moon beam",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    render(<EntityInspector entity={entity} />);
    expect(screen.getByText("Scene light")).toBeTruthy();
    expect(screen.getByText(/invisible in Play/)).toBeTruthy();
    expect((screen.getByLabelText("Light anchor y") as HTMLInputElement).value).toBe("3.2");
    expect((screen.getByLabelText("Light direction z") as HTMLInputElement).value).toBe("-0.35");
    expect(screen.getByText("Cone")).toBeTruthy();
  });
});
