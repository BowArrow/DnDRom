import { useEffect, useRef, useState } from "react";
import { restyleScene } from "../ai/sceneStyleClient";
import type { GameMap } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";
import { beginGenerationJob, updateGenerationJob, waitForGenerationJobTurn } from "../state/generationJobs";

export function SceneArtPanel({ map, disabled, onChange, onBusy, onNotify }: { map: GameMap; disabled: boolean; onChange: (map: GameMap) => void; onBusy: (busy: boolean) => void; onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void }) {
  const [instruction, setInstruction] = useState("");
  const [references, setReferences] = useState<File[]>([]);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [previous, setPrevious] = useState<GameMap | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeMapId = useRef(map.id); activeMapId.current = map.id;
  useEffect(() => () => abortRef.current?.abort(), []);
  const run = async () => {
    if (disabled || working || !instruction.trim()) return;
    const controller = new AbortController(); abortRef.current = controller;
    setPrevious(structuredClone(map)); setWorking(true); onBusy(true);
    const state = useCampaignStore.getState(), campaignId = state.campaign.id;
    const jobId = beginGenerationJob({ kind: "scene", label: "Scene art direction", message: "Preparing scene style", stageLabel: "Scene styling", percent: 1, onCancel: () => controller.abort() });
    const stillCurrent = () => !controller.signal.aborted && activeMapId.current === map.id && useCampaignStore.getState().campaign.id === campaignId;
    try {
      if (!await waitForGenerationJobTurn(jobId)) return;
      const result = await restyleScene({ map, instruction, references, settings: state.campaign.settings, signal: controller.signal,
        saveMaterial: (asset) => { if (stillCurrent()) state.saveMaterialAsset(asset); }, saveProp: (asset) => { if (stillCurrent()) state.savePropAsset(asset); },
        onPreview: (preview) => { if (stillCurrent()) onChange(preview); },
        onProgress: (message, percent) => { setStatus(message); updateGenerationJob(jobId, { message, percent, stageLabel: "Scene styling" }); },
      });
      if (stillCurrent()) { onChange(result.map); onNotify(result.warnings.join(" ") || "Scene restyled. Your earlier version is available with Undo style.", result.warnings.length ? "warning" : "success"); }
      updateGenerationJob(jobId, { status: "complete", percent: 100, message: "Scene style ready" });
    } catch (error) {
      const message = controller.signal.aborted ? "Styling stopped. Completed surfaces remain available; Undo restores the original scene." : error instanceof Error ? error.message : "Scene styling failed";
      setStatus(message); updateGenerationJob(jobId, { status: "error", message }); onNotify(message, controller.signal.aborted ? "info" : "error");
    } finally { setWorking(false); onBusy(false); abortRef.current = null; }
  };
  return <section className="world-blueprint-controls" aria-label="Scene art direction">
    <strong>Art direction & custom props</strong>
    <label className="field-label">Describe the new style<textarea rows={3} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Ink-washed timber, jade roof tiles and warm paper lanterns. Add a carved dragon statue beside the gate." disabled={working} /></label>
    <label className="field-label">Style references · up to 3 images<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={working} onChange={(event) => setReferences([...event.target.files ?? []].slice(0, 3))} /></label>
    {references.length > 0 && <small>{references.map((file) => file.name).join(", ")}</small>}
    <small>Generate coordinated surfaces and requested 3D props locally. Normal, roughness and AO maps are derived from the new albedo. Geometry changes belong in the world description.</small>
    <button className="primary-button" disabled={disabled || working || !instruction.trim()} onClick={() => void run()}>Restyle scene & create props</button>
    {working && <button onClick={() => abortRef.current?.abort()}>Stop styling</button>}
    {previous && previous.id === map.id && <button disabled={disabled || working} onClick={() => { onChange(previous); setPrevious(null); setStatus("Original scene restored"); }}>Undo style</button>}
    {status && <p role="status">{status}</p>}
  </section>;
}
