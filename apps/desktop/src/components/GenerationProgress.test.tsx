// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatGenerationDuration, GenerationProgress } from "./GenerationProgress";

describe("generation progress", () => {
  it('shows the full failure and stops claiming live progress',()=>{
    const message='Mainland landing needs 11 supported parcels; this site supports only 3';
    const {getByText,queryByText}=render(<GenerationProgress value={{status:'error',message,percent:40,startedAt:Date.now(),stageLabel:'Sites',reportedByEngine:true}}/>);
    expect(getByText(message)).toBeTruthy();
    expect(getByText('Stopped')).toBeTruthy();
    expect(queryByText('Live progress from the local engine')).toBeNull();
  });
  it('does not present an invented percentage while the local model is planning',()=>{
    const {getByRole,getByText}=render(<GenerationProgress value={{status:'running',message:'Reading scene requirements',percent:0,indeterminate:true,startedAt:Date.now(),stageLabel:'Scene planning'}} label="Planning activity"/>);
    expect(getByRole('progressbar',{name:'Planning activity'}).hasAttribute('aria-valuenow')).toBe(false);
    expect(getByText('Working')).toBeTruthy();
  });
  it("shows a determinate, accessible local-generation state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T20:00:42Z"));
    render(<GenerationProgress value={{
      status: "running",
      message: "Pixal3D: Generate textured mesh",
      percent: 67,
      startedAt: new Date("2026-09-01T20:00:00Z").getTime(),
      stageLabel: "Step 4 of 5 · 3D generation",
      detail: "14 of 21 workflow nodes complete",
      reportedByEngine: true,
    }} label="Character generation progress" />);

    const bar = screen.getByRole("progressbar", { name: "Character generation progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("67");
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByText("Elapsed 42s")).toBeTruthy();
    expect(screen.getByText("14 of 21 workflow nodes complete")).toBeTruthy();
    vi.useRealTimers();
  });

  it("formats slow local runs without losing the hours", () => {
    expect(formatGenerationDuration(9)).toBe("9s");
    expect(formatGenerationDuration(125)).toBe("2:05");
    expect(formatGenerationDuration(3_725)).toBe("62:05");
  });

  it("offers cancellation for a running local job", () => {
    const onCancel = vi.fn();
    render(<GenerationProgress value={{
      status: "running",
      message: "Painting the existing mesh",
      percent: 42,
      startedAt: Date.now(),
      stageLabel: "Revision 2 of 2",
    }} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
