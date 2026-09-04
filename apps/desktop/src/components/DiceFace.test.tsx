// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiceFace } from "./DiceFace";

describe("DiceFace", () => {
  it("renders a distinct die silhouette with its rolled value", () => {
    const { container } = render(<DiceFace sides={20} value={17} />);
    expect(container.querySelector(".dice-face-d20")).not.toBeNull();
    expect(screen.getByText("17")).not.toBeNull();
  });

  it("uses a percentile mark for an unrolled d100", () => {
    render(<DiceFace sides={100} />);
    expect(screen.getByText("%")).not.toBeNull();
  });

  it("reflects an assigned custom theme in the tray", () => {
    const { container } = render(<DiceFace sides={20} colors={{ body: "#123456", number: "#fedcba" }} />);
    const die = container.querySelector<HTMLElement>(".dice-face")!;
    expect(die.style.getPropertyValue("--die-color")).toBe("#123456");
    expect(die.style.getPropertyValue("--die-number")).toBe("#fedcba");
  });
});
