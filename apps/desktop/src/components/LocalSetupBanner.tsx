import { useEffect, useState } from "react";
import { Check, Download, LoaderCircle, RefreshCw, X } from "lucide-react";
import { formatRuntimeBytes, provisionLocalCreationSuite, runtimeProgressPercent, type LocalRuntimeProgress } from "../ai/localRuntime";

interface LocalSetupBannerProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

const featureLabel = (feature: LocalRuntimeProgress["feature"]): string => feature === "characterPixal3d"
  ? "Pixal3D"
  : feature === "characterTrellis2"
    ? "TRELLIS.2"
    : "Scene generation";

export function LocalSetupBanner({ onNotify }: LocalSetupBannerProps) {
  const [state, setState] = useState<"idle" | "installing" | "ready" | "error">("idle");
  const [progress, setProgress] = useState<LocalRuntimeProgress | null>(null);
  const [message, setMessage] = useState("Preparing local creation suite…");
  const [dismissed, setDismissed] = useState(false);

  const provision = async () => {
    setDismissed(false);
    setState("installing");
    setMessage("Checking the local creation suite…");
    try {
      const result = await provisionLocalCreationSuite((event) => {
        setProgress(event);
        setMessage(`${featureLabel(event.feature)} · ${event.message}`);
      });
      if (!result) {
        setDismissed(true);
        return;
      }
      setState("ready");
      setMessage("Pixal3D, TRELLIS.2, and scene generation are ready locally");
      onNotify("The complete local creation suite is ready.", "success");
      window.setTimeout(() => setDismissed(true), 5000);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Local creation setup stopped";
      setState("error");
      setMessage(detail);
      onNotify(detail, "error");
    }
  };

  useEffect(() => { void provision(); }, []);

  if (dismissed) return null;
  const percent = progress ? runtimeProgressPercent(progress) : 0;
  const downloadsComplete = Boolean(progress && progress.totalBytes > 0 && progress.completedBytes >= progress.totalBytes && progress.stage !== "ready");
  return (
    <aside className={`local-suite-banner ${state}`} aria-live="polite">
      <span className="suite-icon">{state === "ready" ? <Check size={17} /> : state === "installing" ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}</span>
      <div>
        <strong>{state === "error" ? "Local setup needs another try" : state === "ready" ? "Local creation suite ready" : "Installing local creation suite"}</strong>
        <small>{message}</small>
        {state === "installing" && progress && <i role="progressbar" aria-label="Local creation suite setup" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><b style={{ width: `${percent}%` }} /></i>}
        {state === "installing" && progress && <em>{percent}% · {downloadsComplete ? "Downloads complete · finalizing tools" : `${formatRuntimeBytes(progress.completedBytes)} / ${formatRuntimeBytes(progress.totalBytes)}`}</em>}
      </div>
      {state === "error" ? <button onClick={() => void provision()}><RefreshCw size={14} /> Resume</button> : state === "ready" ? <button aria-label="Dismiss setup status" onClick={() => setDismissed(true)}><X size={14} /></button> : null}
    </aside>
  );
}
