// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("background generation jobs", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it("keeps running progress monotonic and reserves 100% for completion", async () => {
    const jobs = await import("./generationJobs");
    const id = jobs.beginGenerationJob({ kind: "scene", label: "Scene creation", message: "Starting", stageLabel: "Setup", percent: 4 });
    jobs.updateGenerationJob(id, { percent: 72, message: "Building geometry" });
    jobs.updateGenerationJob(id, { percent: 30 });
    expect(jobs.generationJobsSnapshot()[0].percent).toBe(72);
    jobs.updateGenerationJob(id, { percent: 100 });
    expect(jobs.generationJobsSnapshot()[0].percent).toBe(99);
    jobs.updateGenerationJob(id, { status: "complete" });
    expect(jobs.generationJobsSnapshot()[0].percent).toBe(100);
  });

  it("marks an unfinished previous-session job as safely interrupted", async () => {
    window.localStorage.setItem("dndrom.generationJobs.v1", JSON.stringify([{ id: "old", kind: "scene", label: "Scene", status: "running", message: "Working", stageLabel: "3D", percent: 62, startedAt: 1, updatedAt: 2 }]));
    const jobs = await import("./generationJobs");
    expect(jobs.generationJobsSnapshot()[0].status).toBe("error");
    expect(jobs.generationJobsSnapshot()[0].message).toMatch(/previous DnDRom session closed/i);
  });

  it("clears failed scene activity before a true reconstruction retry", async () => {
    const jobs = await import("./generationJobs");
    const failedScene = jobs.beginGenerationJob({ kind: "scene", label: "Scene", message: "Starting", stageLabel: "3D" });
    const failedProp = jobs.beginGenerationJob({ kind: "prop", label: "Prop", message: "Starting", stageLabel: "3D" });
    jobs.updateGenerationJob(failedScene, { status: "error" });
    jobs.updateGenerationJob(failedProp, { status: "error" });

    jobs.dismissFailedGenerationJobs("scene");

    expect(jobs.generationJobsSnapshot().some((job) => job.id === failedScene)).toBe(false);
    expect(jobs.generationJobsSnapshot().some((job) => job.id === failedProp)).toBe(true);
  });

  it("runs jobs through one FIFO local-engine slot", async () => {
    const jobs = await import("./generationJobs");
    const first = jobs.beginGenerationJob({ kind: "scene", label: "First", message: "Starting", stageLabel: "Compile" });
    const second = jobs.beginGenerationJob({ kind: "scene", label: "Second", message: "Waiting", stageLabel: "Compile" });
    const third = jobs.beginGenerationJob({ kind: "prop", label: "Third", message: "Waiting", stageLabel: "Mesh" });
    expect(jobs.generationJobsSnapshot().find((job) => job.id === first)?.status).toBe("running");
    expect(jobs.generationJobsSnapshot().find((job) => job.id === second)?.status).toBe("queued");
    expect(jobs.generationJobsSnapshot().find((job) => job.id === third)?.status).toBe("queued");
    const secondTurn = jobs.waitForGenerationJobTurn(second);
    jobs.updateGenerationJob(first, { status: "complete" });
    await expect(secondTurn).resolves.toBe(true);
    expect(jobs.generationJobsSnapshot().find((job) => job.id === second)?.status).toBe("running");
    jobs.updateGenerationJob(second, { status: "error" });
    expect(jobs.generationJobsSnapshot().find((job) => job.id === third)?.status).toBe("running");
  });

  it("automatically clears successful activity after the display grace period", async () => {
    vi.useFakeTimers();
    const jobs = await import("./generationJobs");
    const id = jobs.beginGenerationJob({ kind: "scene", label: "Scene", message: "Starting", stageLabel: "Compile" });
    jobs.updateGenerationJob(id, { status: "complete" });
    expect(jobs.generationJobsSnapshot().some((job) => job.id === id)).toBe(true);
    vi.advanceTimersByTime(jobs.COMPLETED_JOB_TTL_MS + 1);
    expect(jobs.generationJobsSnapshot().some((job) => job.id === id)).toBe(false);
    vi.useRealTimers();
  });
});
