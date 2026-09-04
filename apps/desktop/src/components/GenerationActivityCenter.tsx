import { X } from "lucide-react";
import { cancelGenerationJob, dismissGenerationJob, useGenerationJobs } from "../state/generationJobs";
import { GenerationProgress } from "./GenerationProgress";

export function GenerationActivityCenter() {
  const jobs = useGenerationJobs();
  const running = jobs.filter((job) => job.status === "running");
  const queued = jobs.filter((job) => job.status === "queued").sort((left, right) => left.startedAt - right.startedAt);
  const terminal = jobs.filter((job) => job.status === "complete" || job.status === "error").sort((left, right) => right.updatedAt - left.updatedAt);
  const visible = [...running, ...queued, ...terminal].slice(0, 4);
  if (!visible.length) return null;
  return (
    <aside className="generation-activity-center" aria-label="Background generation activity">
      <header><span><strong>Creation activity</strong><small>Jobs continue while you build, play, or switch windows{queued.length ? ` · ${queued.length} queued` : ""}</small></span></header>
      {visible.map((job) => <div className={`generation-activity-job ${job.status}`} key={job.id} data-job-kind={job.kind}>
        <GenerationProgress value={job.status === "queued" ? { ...job, stageLabel: `Queued · position ${queued.findIndex((entry) => entry.id === job.id) + 1}`, message: job.message || "Waiting for the local generation engine" } : job} label={`${job.label} progress`} onCancel={job.status === "running" || job.status === "queued" ? () => cancelGenerationJob(job.id) : undefined} />
        {(job.status === "complete" || job.status === "error") && <button className="generation-activity-dismiss" type="button" title="Dismiss completed activity" aria-label={`Dismiss ${job.label}`} onClick={() => dismissGenerationJob(job.id)}><X size={13} /></button>}
      </div>)}
    </aside>
  );
}
