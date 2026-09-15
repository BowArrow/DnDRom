import { Check, Clock3, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

export interface GenerationProgressView {
  status: "queued" | "running" | "complete" | "error";
  message: string;
  percent: number;
  startedAt: number;
  stageLabel: string;
  detail?: string;
  reportedByEngine?: boolean;
  indeterminate?: boolean;
}

interface GenerationProgressProps {
  value: GenerationProgressView;
  label?: string;
  onCancel?: () => void;
}

export const formatGenerationDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return minutes ? `${minutes}:${remainder.toString().padStart(2, "0")}` : `${remainder}s`;
};

export function GenerationProgress({ value, label = "Generation progress", onCancel }: GenerationProgressProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (value.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [value.startedAt, value.status]);

  const percent = Math.min(100, Math.max(0, Math.round(value.percent)));
  const elapsed = formatGenerationDuration((now - value.startedAt) / 1_000);
  const Icon = value.status === "complete" ? Check : value.status === "error" ? TriangleAlert : value.status === "queued" ? Clock3 : LoaderCircle;

  return (
    <section className={`generation-progress ${value.status}`} aria-live="polite">
      <header>
        <span className="generation-progress-icon"><Icon className={value.status === "running" ? "spin" : ""} size={16} /></span>
        <span><small>{value.stageLabel}</small><strong>{value.message}</strong></span>
        <output>{value.status === 'error' ? 'Stopped' : value.indeterminate&&value.status==='running'?'Working':`${percent}%`}</output>
      </header>
      <div
        className={`generation-progress-track${value.indeterminate&&value.status==='running'?' indeterminate':''}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value.indeterminate?undefined:percent}
        aria-valuetext={value.indeterminate && value.status === "running" ? value.message : `${percent}% ? ${value.message}`}
      >
        <i style={{ width: `${percent}%` }}><b /></i>
      </div>
      <footer>
        <span><Clock3 size={11} /> Elapsed {elapsed}</span>
        <span>{value.status === 'error' ? (value.detail ?? 'Generation stopped. Review the message above.') : value.detail ?? (value.reportedByEngine ? "Live progress from the local engine" : value.status === "running" ? "Still working locally — you can leave DnDRom open" : "Ready to review")}</span>
        {(value.status === "running" || value.status === "queued") && onCancel && <button type="button" onClick={onCancel}><OctagonX size={12} /> {value.status === "queued" ? "Remove" : "Cancel"}</button>}
      </footer>
    </section>
  );
}
