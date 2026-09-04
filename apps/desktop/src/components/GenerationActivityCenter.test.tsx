// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("generation activity center", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("keeps scene progress visible outside the scene creator and forwards cancellation", async () => {
    const jobs = await import("../state/generationJobs");
    const cancelled = vi.fn();
    jobs.beginGenerationJob({ kind: "scene", label: "Scene creation", message: "Building COLMAP views", stageLabel: "Scene 3 of 5 · Reconstruction", percent: 54, reportedByEngine: true, onCancel: cancelled });
    const { GenerationActivityCenter } = await import("./GenerationActivityCenter");
    render(<GenerationActivityCenter />);
    expect(screen.getByRole("progressbar", { name: "Scene creation progress" }).getAttribute("aria-valuenow")).toBe("54");
    expect(screen.getByText(/continue while you build, play, or switch windows/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
