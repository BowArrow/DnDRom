import { useRef, useState } from "react";
import { Cpu, ExternalLink, Image, LoaderCircle, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  downloadComfyOutput,
  preparePanoramaWorkflow,
  prepareSplatKitWorkflow,
  queueComfyWorkflow,
  testComfyUi,
  uploadComfyImage,
  waitForComfyPrompt,
  type ComfyWorkflow,
} from "../ai/splatKitClient";
import { storeSplatFile } from "../persistence/splatAssets";
import { useCampaignStore } from "../state/campaignStore";

interface WorldSplatPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

const formatBytes = (bytes: number): string => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

const OFFLINE_SCENE_IDEAS = [
  { name: "Moonlit harbor", tags: "coast city night mystery", prompt: "A moonlit medieval harbor enclosed by weathered stone warehouses, wet docks reflecting lantern light, ships beyond a sea wall, navigable alleys, cinematic blue hour, seamless 360 panorama", palette: "#173248,#a8824b" },
  { name: "Ancient forest shrine", tags: "forest ruins magic nature", prompt: "An ancient moss-covered forest shrine beneath enormous old-growth trees, broken statues, a circular clearing, soft shafts of morning light, multiple paths through dense woodland, seamless 360 panorama", palette: "#183b2b,#879c65" },
  { name: "Mountain citadel", tags: "mountain fortress snow city", prompt: "A fortified mountain citadel carved into dark cliffs above snowy valleys, bridges, courtyards and watchtowers, crisp dawn light, grand fantasy scale, seamless 360 panorama", palette: "#394654,#c3bda9" },
  { name: "Desert caravanserai", tags: "desert town market warm", prompt: "A bustling desert caravanserai surrounding a shaded market courtyard, sandstone arcades, colorful cloth awnings, distant dunes and caravan trails, late afternoon sun, seamless 360 panorama", palette: "#8f5a32,#dfb56f" },
  { name: "Sunken temple", tags: "swamp ruins water danger", prompt: "A partially sunken temple in a misty green marsh, vine-covered columns rising from dark water, wooden walkways and hidden entrances, overcast atmospheric light, seamless 360 panorama", palette: "#29443c,#788866" },
  { name: "Feywild village", tags: "village whimsical magic flowers", prompt: "A whimsical woodland village built among giant luminous flowers and twisting roots, tiny bridges, warm windows, drifting motes and twilight violet skies, seamless 360 panorama", palette: "#4b315d,#c27e91" },
  { name: "Volcanic observatory", tags: "lava tower dramatic dungeon", prompt: "An arcane observatory on a volcanic caldera, black stone platforms, brass instruments, lava channels and a storm-lit sky, dramatic but readable pathways, seamless 360 panorama", palette: "#3b2223,#d26c35" },
  { name: "Frozen fishing town", tags: "snow coast village winter", prompt: "A remote frozen fishing town beside a dark arctic sea, timber houses, snow-packed lanes, boats trapped in ice and warm smoke-lit windows, polar twilight, seamless 360 panorama", palette: "#294254,#8fb0bd" },
  { name: "Underground crystal city", tags: "cavern city crystal underdark", prompt: "A vast underground city built around luminous crystal formations, terraces and suspended bridges crossing a deep cavern, cool magical illumination, seamless 360 panorama", palette: "#272c52,#6e8ec7" },
  { name: "Pastoral crossroads", tags: "plains tavern village daylight", prompt: "A pastoral countryside crossroads with a welcoming timber inn, farms, stone walls and roads leading toward distant villages, bright spring morning, seamless 360 panorama", palette: "#637b43,#c6a267" },
  { name: "Gothic capital", tags: "city dark gothic rain", prompt: "A dense gothic capital square in the rain, cathedral spires, narrow streets, covered markets and torchlit archways, dramatic cloud cover, seamless 360 panorama", palette: "#292b34,#786154" },
  { name: "Floating sky ruins", tags: "sky ruins fantasy islands", prompt: "Ancient ruins spread across floating islands above a sea of clouds, rope bridges, waterfalls falling into open sky and a central shattered temple, golden sunrise, seamless 360 panorama", palette: "#6e92ac,#d9b77a" },
] as const;

const parseWorkflow = async (file: File): Promise<ComfyWorkflow> => {
  const parsed = JSON.parse(await file.text()) as { prompt?: unknown } | unknown;
  const candidate = parsed && typeof parsed === "object" && "prompt" in parsed && (parsed as { prompt?: unknown }).prompt
    ? (parsed as { prompt: unknown }).prompt
    : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Export the selected ComfyUI workflow in API format");
  return candidate as ComfyWorkflow;
};

export function WorldSplatPanel({ onNotify }: WorldSplatPanelProps) {
  const [open, setOpen] = useState(false);
  const [panorama, setPanorama] = useState<File | null>(null);
  const [workflowFile, setWorkflowFile] = useState<File | null>(null);
  const [panoramaWorkflowFile, setPanoramaWorkflowFile] = useState<File | null>(null);
  const [sourceMode, setSourceMode] = useState<"prompt" | "upload">("prompt");
  const [ideaSearch, setIdeaSearch] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const campaign = useCampaignStore((state) => state.campaign);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const addScenery = useCampaignStore((state) => state.addScenery);
  const removeScenery = useCampaignStore((state) => state.removeScenery);
  const endpoint = campaign.settings.comfyUiEndpoint || "http://127.0.0.1:8188";
  const scenery = campaign.map.scenery ?? [];
  const visibleIdeas = OFFLINE_SCENE_IDEAS.filter((idea) => `${idea.name} ${idea.tags} ${idea.prompt}`.toLowerCase().includes(ideaSearch.trim().toLowerCase()));

  const importSplat = async (file?: File, source: "splatkit" | "import" = "import") => {
    if (!file) return;
    setStatus(`Validating ${file.name}…`);
    try {
      const asset = await storeSplatFile(file, source);
      addScenery(asset);
      setStatus(`${asset.name} loaded as presentation scenery`);
      onNotify(`${asset.name} was stored locally and added above the authoritative mesh map.`, "success");
    } catch (error) {
      setStatus("Import failed");
      onNotify(error instanceof Error ? error.message : "Splat import failed", "error");
    }
  };

  const testConnection = async () => {
    setStatus("Connecting to ComfyUI…");
    try {
      await testComfyUi(endpoint);
      setStatus("ComfyUI is ready");
      onNotify("Connected to the local ComfyUI runtime.", "success");
    } catch (error) {
      setStatus("ComfyUI unavailable");
      onNotify(error instanceof Error ? error.message : "ComfyUI connection failed", "error");
    }
  };

  const generate = async () => {
    if (!workflowFile || !description.trim() || (sourceMode === "upload" ? !panorama : !panoramaWorkflowFile)) {
      onNotify(sourceMode === "prompt" ? "Choose both official API workflows and a scene description." : "Choose a 2:1 panorama, the SplatKit API workflow, and an accurate scene description.", "warning");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    try {
      let sourcePanorama = panorama;
      await testComfyUi(endpoint);
      if (sourceMode === "prompt") {
        setStatus("Reading the local text-to-panorama workflow…");
        const panoramaWorkflow = preparePanoramaWorkflow(await parseWorkflow(panoramaWorkflowFile!), description.trim());
        const panoramaPromptId = await queueComfyWorkflow(endpoint, panoramaWorkflow);
        let panoramaPolls = 0;
        const panoramaResult = await waitForComfyPrompt(endpoint, panoramaPromptId, controller.signal, () => {
          panoramaPolls++;
          setStatus(`Generating the 360 panorama locally… ${panoramaPolls * 3}s`);
        });
        const panoramaOutput = [...panoramaResult.outputs].reverse().find((output) => /\.(png|jpe?g|webp)$/i.test(output.filename));
        if (!panoramaOutput) throw new Error("The panorama workflow completed without a PNG, JPEG, or WebP output. Add a Save Image node to its active text-to-panorama branch.");
        sourcePanorama = await downloadComfyOutput(endpoint, panoramaOutput);
        setPanorama(sourcePanorama);
      }
      if (!sourcePanorama) throw new Error("No panorama is available for SplatKit");
      setStatus("Reading the SplatKit dataset workflow…");
      const workflow = await parseWorkflow(workflowFile);
      setStatus("Uploading panorama locally…");
      const upload = await uploadComfyImage(endpoint, sourcePanorama);
      const prepared = prepareSplatKitWorkflow(workflow, upload, description.trim());
      setStatus("Queueing MoGe, WAN, and SphereSfM…");
      const promptId = await queueComfyWorkflow(endpoint, prepared);
      let polls = 0;
      setStatus(`SplatKit job ${promptId.slice(0, 8)} is running…`);
      const result = await waitForComfyPrompt(endpoint, promptId, controller.signal, () => {
        polls++;
        setStatus(`Generating views and COLMAP dataset… ${polls * 3}s`);
      });
      const generatedSplat = result.outputs.find((output) => /\.(compressed\.)?(ply|sog)$/i.test(output.filename));
      if (generatedSplat) {
        setStatus(`Importing ${generatedSplat.filename}…`);
        await importSplat(await downloadComfyOutput(endpoint, generatedSplat), "splatkit");
      } else {
        setStatus("COLMAP dataset ready — train it, then import PLY/SOG");
        onNotify("SplatKit finished its COLMAP dataset. Train it in Brush or LichtFeld, then use Import trained splat here.", "success");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setStatus("Generation cancelled");
      else {
        setStatus("Generation failed");
        onNotify(error instanceof Error ? error.message : "SplatKit generation failed", "error");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  return (
    <>
      <button className="splat-studio-button" onClick={() => { setDescription(description || `${campaign.map.name}: ${campaign.synopsis}`); setOpen(true); }}>
        <Sparkles size={16} /><span><strong>AI scenery studio</strong><small>Local panorama → Gaussian world</small></span>
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !running && setOpen(false)}>
          <section className="splat-studio-modal" role="dialog" aria-modal="true" aria-label="AI Gaussian scenery studio">
            <button className="modal-close" disabled={running} onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
            <span className="eyebrow"><Sparkles size={13} /> ComfyUI-SplatKit bridge</span>
            <h2>Finish this world with local AI</h2>
            <p>Run Mickmumpitz’s open-source pipeline against your own ComfyUI. The generated splat is visual scenery; DnDRom’s mesh map remains authoritative for gameplay.</p>

            <label className="field-label">ComfyUI endpoint<input value={endpoint} onChange={(event) => updateSettings({ comfyUiEndpoint: event.target.value })} /></label>
            <button className="connection-test" onClick={testConnection} disabled={running}><Cpu size={14} /> Test local runtime</button>
            <div className="panorama-source-tabs">
              <button className={sourceMode === "prompt" ? "active" : ""} onClick={() => setSourceMode("prompt")}><Sparkles size={14} /> Prompt locally</button>
              <button className={sourceMode === "upload" ? "active" : ""} onClick={() => setSourceMode("upload")}><Image size={14} /> Use my panorama</button>
            </div>
            <label className="field-label">Accurate panorama description<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>

            {sourceMode === "prompt" && <section className="offline-idea-library">
              <div className="idea-library-heading"><div><strong>Offline scene ideas</strong><small>No web search or prompt upload</small></div><label><Search size={13} /><input value={ideaSearch} onChange={(event) => setIdeaSearch(event.target.value)} placeholder="Search coast, town, forest…" /></label></div>
              <div className="idea-card-grid">{visibleIdeas.map((idea) => <button key={idea.name} onClick={() => setDescription(idea.prompt)} style={{ background: `linear-gradient(145deg, ${idea.palette.split(",")[0]}, ${idea.palette.split(",")[1]})` }}><strong>{idea.name}</strong><small>{idea.tags}</small></button>)}</div>
            </section>}

            <div className="splat-input-grid">
              {sourceMode === "prompt"
                ? <label><Sparkles size={18} /><strong>Panorama API workflow</strong><small>{panoramaWorkflowFile?.name ?? "Official workflow 0 JSON"}</small><input type="file" accept="application/json,.json" onChange={(event) => setPanoramaWorkflowFile(event.target.files?.[0] ?? null)} /></label>
                : <label><Image size={18} /><strong>2:1 panorama</strong><small>{panorama?.name ?? "PNG, JPEG, or WebP"}</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPanorama(event.target.files?.[0] ?? null)} /></label>}
              <label><Cpu size={18} /><strong>Dataset API workflow</strong><small>{workflowFile?.name ?? "Official workflow 1 JSON"}</small><input type="file" accept="application/json,.json" onChange={(event) => setWorkflowFile(event.target.files?.[0] ?? null)} /></label>
              <label><Upload size={18} /><strong>Import trained splat</strong><small>PLY, compressed PLY, or SOG</small><input type="file" accept=".ply,.sog" onChange={(event) => void importSplat(event.target.files?.[0])} /></label>
            </div>

            <div className="splat-status"><span className={running ? "pulse" : ""} />{status}</div>
            <div className="modal-actions">
              {running ? <button className="danger-button" onClick={() => abortRef.current?.abort()}>Cancel</button> : <button onClick={() => setOpen(false)}>Close</button>}
              <button className="primary-button" disabled={running || !workflowFile || !description.trim() || (sourceMode === "prompt" ? !panoramaWorkflowFile : !panorama)} onClick={generate}>
                {running ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} {sourceMode === "prompt" ? "Generate panorama and world locally" : "Queue local world generation"}
              </button>
            </div>

            {scenery.length > 0 && <section className="splat-list"><strong>Scenery on {campaign.map.name}</strong>{scenery.map((entry) => <div key={entry.id}><span>{entry.name}<small>{entry.format.toUpperCase()} · {formatBytes(entry.byteLength)} · presentation only</small></span><button title="Remove from map" onClick={() => removeScenery(entry.id)}><Trash2 size={14} /></button></div>)}</section>}
            <p className="splat-links"><a href="https://github.com/mickmumpitz/ComfyUI-SplatKit" target="_blank" rel="noreferrer"><ExternalLink size={12} /> SplatKit and workflows</a><a href="https://github.com/ArthurBrussee/brush" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Brush trainer</a><a href="https://polyhaven.com/hdris" target="_blank" rel="noreferrer"><ExternalLink size={12} /> Browse Poly Haven online</a></p>
            <p className="local-only-note">Local-only by default: prompts, images, workflows, and generated outputs go only to the configured loopback ComfyUI endpoint. External catalog links open in your browser and are never queried automatically.</p>
            <p className="warning-callout">The main SplatKit graph outputs a COLMAP dataset, not a trained splat. WAN 2.1 generation is a quality-tier creator job and generally needs a modern NVIDIA GPU; it is never required to play.</p>
          </section>
        </div>
      )}
    </>
  );
}
