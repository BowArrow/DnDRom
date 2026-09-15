import { Archive, ArrowLeft, Check, Copy, Cpu, Download, Dices, Edit3, ImagePlus, LoaderCircle, Orbit, Paintbrush, Plus, Save, Sparkles, Trash2, Upload, WandSparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateLocalDiceAlbedo } from "../ai/diceTextureClient";
import { designDiceEffects, suggestDiceEffectsOffline } from "../ai/diceEffectDirector";
import { loadBundledWorkflow } from "../ai/comfyWorkflowPreset";
import { ensureLocalRuntime, formatRuntimeBytes, runtimeProgressPercent } from "../ai/localRuntime";
import type { DiceSides, DiceTheme } from "../domain/types";
import { EMERALD_ENERGY_EFFECTS, resolveDiceEffects } from "../domain/diceEffects";
import { deriveDicePbrMaps, inspectDiceTexture, storeDiceTextureSet, type DiceTextureFiles, type DiceTextureSlot } from "../persistence/diceThemes";
import { diceTextureAiPrompt, downloadDiceTexturePrompt, downloadDiceTextureTemplate, inferDiceBodyColor } from "../rendering/diceTextureTemplate";
import { useCampaignStore } from "../state/campaignStore";
import { DiceThemePreview } from "./DiceThemePreview";
import { GenerationProgress, type GenerationProgressView } from "./GenerationProgress";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";
import { DiceThemeAssetPreview } from "./StoredAssetPreview";

interface DiceForgeProps {
  onBack: () => void;
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

const diceSides: DiceSides[] = [4, 6, 8, 10, 12, 20, 100];
const EMPTY_THEMES: DiceTheme[] = [];
const EMPTY_ASSIGNMENTS: Partial<Record<`d${DiceSides}`, string>> = {};
const mapSlots: Array<{ slot: DiceTextureSlot; title: string; help: string }> = [
  { slot: "albedo", title: "Albedo", help: "Base color without lighting" },
  { slot: "normal", title: "Normal", help: "OpenGL +Y surface detail" },
  { slot: "roughness", title: "Roughness", help: "White matte · black glossy" },
  { slot: "metallic", title: "Metallic", help: "White metal · black resin" },
  { slot: "ambientOcclusion", title: "AO", help: "Soft cavity shading" },
  { slot: "emissive", title: "Energy mask", help: "White areas carry animated glow" },
];

const newTheme = (): DiceTheme => {
  const now = new Date().toISOString();
  return {
    id: `dice-theme-${crypto.randomUUID()}`,
    name: "New dice theme",
    description: "Enchanted emerald resin with subtle gold marbling",
    baseColor: "#167f72",
    numberColor: "#f4df9b",
    numberOutlineColor: "#181008",
    roughness: .2,
    metallic: .08,
    clearCoat: 1,
    clearCoatGloss: .95,
    normalStrength: .8,
    maps: {},
    effects: structuredClone(EMERALD_ENERGY_EFFECTS),
    source: "painted",
    createdAt: now,
    updatedAt: now,
  };
};

function TextureSlot({ slot, title, help, file, stored, disabled, onChoose }: { slot: DiceTextureSlot; title: string; help: string; file?: File; stored?: string; disabled: boolean; onChoose: (file: File) => void }) {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <label className={`dice-map-slot ${file || stored ? "ready" : ""}`}>
    {preview ? <img src={preview} alt={`${title} preview`} /> : file || stored ? <Check size={18} /> : <ImagePlus size={18} />}
    <span><strong>{title}</strong><small>{file?.name ?? (stored ? "Saved locally" : help)}</small></span>
    <Upload size={13} />
    <input disabled={disabled} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen) onChoose(chosen); event.currentTarget.value = ""; }} />
  </label>;
}

export function DiceForge({ onBack, onNotify }: DiceForgeProps) {
  const themes = useCampaignStore((state) => state.diceThemeLibrary) ?? EMPTY_THEMES;
  const campaignThemes = useCampaignStore((state) => state.campaign.diceThemes) ?? EMPTY_THEMES;
  const assignments = useCampaignStore((state) => state.campaign.diceThemeAssignments) ?? EMPTY_ASSIGNMENTS;
  const saveDiceTheme = useCampaignStore((state) => state.saveDiceTheme);
  const autosaveDiceTheme = useCampaignStore((state) => state.autosaveDiceTheme);
  const removeDiceTheme = useCampaignStore((state) => state.removeDiceTheme);
  const assignDiceTheme = useCampaignStore((state) => state.assignDiceTheme);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const campaignSettings = useCampaignStore((state) => state.campaign.settings);
  const [theme, setTheme] = useState<DiceTheme>(() => themes[0] ?? newTheme());
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [files, setFiles] = useState<DiceTextureFiles>({});
  const [sides, setSides] = useState<DiceSides>(20);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressView | null>(null);
  const [effectPreviewKey, setEffectPreviewKey] = useState(0);
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error">("saved");
  const fileAutosaveRevision = useRef(0);
  const bodyColorWasChosen = useRef(false);

  useEffect(() => {
    setAutosaveState("saving");
    const timer = window.setTimeout(() => {
      autosaveDiceTheme(theme);
      setAutosaveState("saved");
    }, 450);
    return () => window.clearTimeout(timer);
  }, [autosaveDiceTheme, theme]);

  useEffect(() => {
    if (!Object.keys(files).length) return;
    const revision = ++fileAutosaveRevision.current;
    setAutosaveState("saving");
    const timer = window.setTimeout(() => {
      void storeDiceTextureSet(files).then((stored) => {
        if (revision !== fileAutosaveRevision.current) return;
        setTheme((current) => ({ ...current, maps: { ...current.maps, ...stored }, updatedAt: new Date().toISOString() }));
        setFiles({});
        setAutosaveState("saved");
      }).catch((error) => {
        setAutosaveState("error");
        onNotify(error instanceof Error ? error.message : "Dice texture autosave failed", "error");
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [files, onNotify]);

  const updateTheme = (update: Partial<DiceTheme>) => setTheme((current) => ({ ...current, ...update, updatedAt: new Date().toISOString() }));
  const chooseFile = async (slot: DiceTextureSlot, file: File) => {
    try {
      await inspectDiceTexture(file);
      setFiles((current) => ({ ...current, [slot]: file }));
      onNotify(`${slot === "ambientOcclusion" ? "AO" : slot} map loaded into the preview.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Dice texture could not be loaded", "error");
    }
  };

  const deriveMaps = async () => {
    const albedo = files.albedo;
    if (!albedo) { onNotify("Choose or generate an albedo texture first.", "warning"); return; }
    setWorking(true);
    try {
      setFiles(await deriveDicePbrMaps(albedo, theme.normalStrength));
      onNotify("Starter normal, roughness, metallic, AO, and animated energy-mask maps were generated locally.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not derive PBR maps", "error");
    } finally { setWorking(false); }
  };

  const save = async () => {
    setWorking(true);
    try {
      const stored = await storeDiceTextureSet(files);
      const saved = { ...theme, maps: { ...theme.maps, ...stored }, updatedAt: new Date().toISOString() };
      saveDiceTheme(saved);
      assignDiceTheme(sides, saved.id);
      setTheme(saved);
      setFiles({});
      onNotify(`${saved.name} is assigned to d${sides}. Changes continue saving automatically.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Dice theme could not be saved", "error");
    } finally { setWorking(false); }
  };

  const generateLocally = async () => {
    if (!theme.description.trim()) { onNotify("Describe the dice surface first.", "warning"); return; }
    setWorking(true);
    const generationBodyColor = bodyColorWasChosen.current ? theme.baseColor : inferDiceBodyColor(theme.description, theme.baseColor);
    if (generationBodyColor !== theme.baseColor) updateTheme({ baseColor: generationBodyColor });
    const startedAt = Date.now();
    setProgress({ status: "running", message: "Preparing the private local texture generator…", percent: 2, startedAt, stageLabel: "Step 1 of 3 · Local setup" });
    try {
      const runtime = await ensureLocalRuntime("world", (event) => setProgress({
        status: "running",
        message: event.message,
        percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .1)),
        startedAt,
        stageLabel: "Step 1 of 3 · Local setup",
        detail: `${formatRuntimeBytes(event.completedBytes)} / ${formatRuntimeBytes(event.totalBytes)}`,
      }));
      updateSettings({ comfyUiEndpoint: runtime.endpoint });
      const workflow = await loadBundledWorkflow("/workflows/splatkit-panorama.json");
      const albedo = await generateLocalDiceAlbedo(runtime.endpoint, theme.description, generationBodyColor, workflow, undefined, (event) => setProgress({
        status: "running", message: event.message, percent: 10 + event.percent * .82, startedAt, stageLabel: "Step 2 of 3 · Local AI texture", reportedByEngine: event.reportedByEngine,
      }));
      setProgress({ status: "running", message: "Deriving editable PBR companion maps…", percent: 94, startedAt, stageLabel: "Step 3 of 3 · PBR maps" });
      setFiles(await deriveDicePbrMaps(albedo, theme.normalStrength));
      updateTheme({ source: "local-ai" });
      setProgress({ status: "complete", message: "Local dice texture ready to review", percent: 100, startedAt, stageLabel: "Complete · Texture ready" });
      onNotify("Local AI texture and starter PBR maps are ready. Review and save the theme.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Local dice texture generation failed";
      setProgress((current) => ({ status: "error", message, percent: current?.percent ?? 0, startedAt, stageLabel: "Generation stopped", detail: "Your theme settings are still saved in this workspace" }));
      onNotify(message, "error");
    } finally { setWorking(false); }
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(diceTextureAiPrompt(theme.description, theme.baseColor));
    onNotify("Cloud/local AI texture prompt copied.", "success");
  };
  const loadTheme = (selected: DiceTheme) => { bodyColorWasChosen.current = true; setTheme(structuredClone(selected)); setFiles({}); setProgress(null); setAutosaveState("saved"); };
  const startNew = () => { bodyColorWasChosen.current = false; setTheme(newTheme()); setFiles({}); setProgress(null); };
  const assignSet = () => { diceSides.forEach((die) => assignDiceTheme(die, theme.id)); onNotify(`${theme.name} assigned to the complete dice set.`, "success"); };
  const effects = resolveDiceEffects(theme.effects);
  const updateSurface = (update: Partial<typeof effects.surface>) => updateTheme({ effects: { ...effects, surface: { ...effects.surface, ...update } } });
  const updateTrail = (update: Partial<typeof effects.trail>) => updateTheme({ effects: { ...effects, trail: { ...effects.trail, ...update } } });
  const updateImpact = (update: Partial<typeof effects.impact>) => updateTheme({ effects: { ...effects, impact: { ...effects.impact, ...update } } });
  const assistEffects = async () => {
    const direction = theme.effectPrompt?.trim() || theme.description.trim();
    if (!direction) { onNotify("Describe the effect you want first.", "warning"); return; }
    setWorking(true);
    try {
      const result = await designDiceEffects(direction, campaignSettings, undefined, theme.description);
      updateTheme({ effects: result.effects });
      setEffectPreviewKey((value) => value + 1);
      onNotify(result.provider === "local-ai" ? "The local AI designed a complete dice effect stack." : "The offline effect assistant designed a complete effect stack.", "success");
      if (result.warning) onNotify(`Local AI was unavailable, so the offline assistant completed it. ${result.warning}`, "warning");
    } finally { setWorking(false); }
  };
  const applyEffectPreset = (prompt: string) => { updateTheme({ effects: suggestDiceEffectsOffline(prompt) }); setEffectPreviewKey((value) => value + 1); };

  return <section className="creator-workspace-page dice-forge-page" aria-label="Dice Forge">
    <div className="creator-page-actions"><button onClick={onBack} disabled={working}><ArrowLeft size={15} /> Tabletop</button><small className={`dice-autosave-status ${autosaveState}`}>{autosaveState === "saving" ? "Saving theme…" : autosaveState === "error" ? "Autosave needs attention" : "Theme saved automatically"}</small><button onClick={() => setCatalogueOpen(true)} disabled={working}><Archive size={15} /> Dice catalogue <small>{themes.length}</small></button><button onClick={startNew} disabled={working}><Plus size={15} /> New theme</button></div>
    <span className="eyebrow"><Dices size={13} /> Custom dice workshop</span>
    <h2>Forge your own physical dice</h2>
    <p>Paint a universal surface, generate one with the private local AI, or use the downloadable template with any cloud art tool. Numbers remain separately engraved and readable.</p>
    <div className="creator-editor-shell dice-forge-shell">
      <aside className="creator-sidebar creator-sidebar-left" aria-label="Dice texture source">
        <div className="sidebar-section-heading"><Paintbrush size={14} /><span><strong>Surface design</strong><small>Paint, import, or generate</small></span></div>
        <label className="field-label">Theme name<input value={theme.name} onChange={(event) => updateTheme({ name: event.target.value })} /></label>
        <label className="field-label vellum-field">Describe the material<textarea rows={4} value={theme.description} onChange={(event) => updateTheme({ description: event.target.value })} placeholder="Obsidian resin with violet nebula wisps and tiny gold flecks…" /></label>
        <details className="workspace-disclosure"><summary>Templates & external artwork</summary>
        <section className="dice-template-tools">
          <strong>Universal 2:1 template</strong><small>One wrap layout works across d4–d100. Numbers are separate.</small>
          <button onClick={() => void downloadDiceTextureTemplate()}><Download size={14} /> Download PNG template</button>
          <button onClick={() => void copyPrompt()}><Copy size={14} /> Copy AI prompt</button>
          <button onClick={() => downloadDiceTexturePrompt(theme.description, theme.baseColor)}><Download size={14} /> Download prompt + PBR guide</button>
        </section>
        </details>
        <button className="primary-button magical-button" onClick={() => void generateLocally()} disabled={working || !theme.description.trim()}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Generate texture with local AI</button>
        <small className="dice-ai-note"><Cpu size={12} /> Uses the same private local image model as Scenery Studio. Setup is automatic and resumable.</small>
        <div className="sidebar-section-heading"><Upload size={14} /><span><strong>Custom PBR maps</strong><small>PNG, JPEG, or WebP · 2:1</small></span></div>
        <div className="dice-map-grid">{mapSlots.map((entry) => <TextureSlot key={entry.slot} {...entry} file={files[entry.slot]} stored={theme.maps[entry.slot]} disabled={working} onChoose={(file) => void chooseFile(entry.slot, file)} />)}</div>
        <button className="secondary-generator-button" disabled={working || !files.albedo} onClick={() => void deriveMaps()}><Sparkles size={14} /> Generate starter PBR maps from albedo</button>
      </aside>

      <main className="creator-stage dice-forge-stage" aria-label="Dice 3D preview">
        <DiceThemePreview theme={theme} files={files} sides={sides} effectPreviewKey={effectPreviewKey} />
        {progress && <GenerationProgress value={progress} label="Dice texture generation progress" />}
        <div className="stage-caption"><strong>{theme.name || "Untitled dice theme"}</strong><span>Live PBR wrap · animated energy · roll-effect preview</span></div>
      </main>

      <aside className="creator-sidebar creator-sidebar-right" aria-label="Dice material settings">
        <div className="sidebar-section-heading"><Dices size={14} /><span><strong>Die and material</strong><small>Preview and assign each shape</small></span></div>
        <button className="forge-catalogue-button inline" onClick={() => setCatalogueOpen(true)}><Archive size={14} /><span>Dice set catalogue</span><small>{themes.length} saved · {campaignThemes.length} in campaign</small></button>
        <div className="dice-shape-tabs">{diceSides.map((die) => <button key={die} className={sides === die ? "active" : ""} onClick={() => setSides(die)}>d{die}</button>)}</div>
        <div className="token-color-row dice-color-row"><label>Body<input aria-label="Dice body color" type="color" value={theme.baseColor} onInput={(event) => { bodyColorWasChosen.current = true; updateTheme({ baseColor: event.currentTarget.value }); }} /></label><label>Numbers<input aria-label="Dice number color" type="color" value={theme.numberColor} onInput={(event) => updateTheme({ numberColor: event.currentTarget.value })} /></label><label>Outline<input aria-label="Dice number outline color" type="color" value={theme.numberOutlineColor} onInput={(event) => updateTheme({ numberOutlineColor: event.currentTarget.value })} /></label></div>
        <label className="field-label">Roughness <span>{theme.roughness.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={theme.roughness} onChange={(event) => updateTheme({ roughness: Number(event.target.value) })} /></label>
        <label className="field-label">Metallic <span>{theme.metallic.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={theme.metallic} onChange={(event) => updateTheme({ metallic: Number(event.target.value) })} /></label>
        <label className="field-label">Clear coat <span>{theme.clearCoat.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={theme.clearCoat} onChange={(event) => updateTheme({ clearCoat: Number(event.target.value) })} /></label>
        <label className="field-label">Coat gloss <span>{theme.clearCoatGloss.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={theme.clearCoatGloss} onChange={(event) => updateTheme({ clearCoatGloss: Number(event.target.value) })} /></label>
        <label className="field-label">Normal strength <span>{theme.normalStrength.toFixed(2)}</span><input type="range" min="0" max="2" step="0.05" value={theme.normalStrength} onChange={(event) => updateTheme({ normalStrength: Number(event.target.value) })} /></label>
        <div className="sidebar-section-heading dice-effects-heading"><Zap size={14} /><span><strong>Arcane effects</strong><small>Surface energy, trails, and impact</small></span></div>
        <section className="dice-effect-assistant">
          <label className="field-label dice-effect-prompt">Describe the effect<textarea aria-label="Describe dice effects" rows={3} value={theme.effectPrompt ?? ""} onChange={(event) => updateTheme({ effectPrompt: event.target.value })} placeholder="Pink heart motes orbit the die, leave a rosy trail, then burst into stars on impact…" /></label>
          <button className="magical-button" disabled={working || !(theme.effectPrompt?.trim() || theme.description.trim())} onClick={() => void assistEffects()}>{working ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />} Generate effects with local AI</button>
          <div className="dice-effect-presets" aria-label="Effect presets">
            <button onClick={() => applyEffectPreset("emerald arcane energy veins")}>Emerald</button>
            <button onClick={() => applyEffectPreset("storm lightning thunder")}>Storm</button>
            <button onClick={() => applyEffectPreset("lava ember fire")}>Inferno</button>
            <button onClick={() => applyEffectPreset("frost ice crystal")}>Frost</button>
            <button onClick={() => applyEffectPreset("void shadow purple")}>Void</button>
          </div>
        </section>
        <details className="dice-effect-layer" open>
          <summary><span><Zap size={13} /> Surface energy</span><input aria-label="Enable surface energy" type="checkbox" checked={effects.surface.enabled} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSurface({ enabled: event.target.checked })} /></summary>
          <label className="field-label">Pattern<select value={effects.surface.style} onChange={(event) => updateSurface({ style: event.target.value as typeof effects.surface.style })}><option value="arcane-veins">Arcane veins</option><option value="lightning-cracks">Glowing cracks</option><option value="lava">Lava channels</option><option value="frost">Frost crystal</option><option value="runes">Ancient runes</option></select></label>
          <div className="dice-effect-color"><label>Energy color<input type="color" value={effects.surface.color} onChange={(event) => updateSurface({ color: event.target.value })} /></label><span style={{ background: effects.surface.color }} /></div>
          <label className="field-label">Glow <span>{effects.surface.intensity.toFixed(1)}</span><input type="range" min="0" max="5" step=".1" value={effects.surface.intensity} onChange={(event) => updateSurface({ intensity: Number(event.target.value) })} /></label>
          <label className="field-label">Flow speed <span>{effects.surface.speed.toFixed(1)}</span><input type="range" min=".05" max="4" step=".05" value={effects.surface.speed} onChange={(event) => updateSurface({ speed: Number(event.target.value) })} /></label>
        </details>
        <details className="dice-effect-layer">
          <summary><span><Orbit size={13} /> Motion trail</span><input aria-label="Enable motion trail" type="checkbox" checked={effects.trail.enabled} onClick={(event) => event.stopPropagation()} onChange={(event) => updateTrail({ enabled: event.target.checked })} /></summary>
          <label className="field-label">Style<select value={effects.trail.style} onChange={(event) => updateTrail({ style: event.target.value as typeof effects.trail.style })}><option value="wisps">Arcane wisps</option><option value="sparks">Bright sparks</option><option value="embers">Falling embers</option></select></label>
          <div className="dice-effect-color"><label>Trail color<input type="color" value={effects.trail.color} onChange={(event) => updateTrail({ color: event.target.value })} /></label><span style={{ background: effects.trail.color }} /></div>
          <label className="field-label">Length <span>{effects.trail.length.toFixed(2)}s</span><input type="range" min=".15" max="1.5" step=".05" value={effects.trail.length} onChange={(event) => updateTrail({ length: Number(event.target.value) })} /></label>
        </details>
        <details className="dice-effect-layer" open>
          <summary><span><Sparkles size={13} /> Particle system</span><input aria-label="Enable dice particles" type="checkbox" checked={effects.particles.enabled} onClick={(event) => event.stopPropagation()} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, enabled: event.target.checked } } })} /></summary>
          <label className="field-label">Particle style<select value={effects.particles.style} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, style: event.target.value as typeof effects.particles.style } } })}><option value="soft-motes">Soft motes</option><option value="sparks">Sparks</option><option value="embers">Embers</option><option value="snow">Snow crystals</option><option value="smoke">Magic smoke</option><option value="stars">Stars</option></select></label>
          <label className="field-label">Emit during<select value={effects.particles.emission} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, emission: event.target.value as typeof effects.particles.emission } } })}><option value="both">Trail and impact</option><option value="trail">Trail only</option><option value="impact">Impact only</option></select></label>
          <div className="dice-effect-color"><label>Primary<input aria-label="Particle primary color" type="color" value={effects.particles.color} onInput={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, color: event.currentTarget.value } } })} /></label><label>Secondary<input aria-label="Particle secondary color" type="color" value={effects.particles.secondaryColor} onInput={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, secondaryColor: event.currentTarget.value } } })} /></label></div>
          <label className="field-label">Particle budget <span>{effects.particles.count}</span><input type="range" min="4" max="96" step="1" value={effects.particles.count} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, count: Number(event.target.value) } } })} /></label>
          <label className="field-label">Lifetime <span>{effects.particles.lifetime.toFixed(2)}s</span><input type="range" min=".15" max="2.5" step=".05" value={effects.particles.lifetime} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, lifetime: Number(event.target.value) } } })} /></label>
          <label className="field-label">Size <span>{effects.particles.size.toFixed(2)}</span><input type="range" min=".02" max=".28" step=".01" value={effects.particles.size} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, size: Number(event.target.value) } } })} /></label>
          <label className="field-label">Speed <span>{effects.particles.speed.toFixed(2)}</span><input type="range" min=".05" max="3.5" step=".05" value={effects.particles.speed} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, speed: Number(event.target.value) } } })} /></label>
          <label className="field-label">Spread <span>{effects.particles.spread.toFixed(2)}</span><input type="range" min=".05" max="2" step=".05" value={effects.particles.spread} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, spread: Number(event.target.value) } } })} /></label>
          <label className="field-label">Turbulence <span>{effects.particles.turbulence.toFixed(2)}</span><input type="range" min="0" max="1" step=".05" value={effects.particles.turbulence} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, turbulence: Number(event.target.value) } } })} /></label>
          <label className="field-label">Gravity <span>{effects.particles.gravity.toFixed(2)}</span><input type="range" min="-3" max="3" step=".1" value={effects.particles.gravity} onChange={(event) => updateTheme({ effects: { ...effects, particles: { ...effects.particles, gravity: Number(event.target.value) } } })} /></label>
          <small className="dice-particle-budget-note">GPU emitter · maximum 96 particles per die · automatically cleaned after each roll</small>
        </details>
        <details className="dice-effect-layer">
          <summary><span><Sparkles size={13} /> Landing impact</span><input aria-label="Enable landing impact" type="checkbox" checked={effects.impact.enabled} onClick={(event) => event.stopPropagation()} onChange={(event) => updateImpact({ enabled: event.target.checked })} /></summary>
          <label className="field-label">Style<select value={effects.impact.style} onChange={(event) => updateImpact({ style: event.target.value as typeof effects.impact.style })}><option value="shockwave">Energy shockwave</option><option value="rune-burst">Rune burst</option><option value="shards">Crystal shards</option></select></label>
          <div className="dice-effect-color"><label>Impact color<input type="color" value={effects.impact.color} onChange={(event) => updateImpact({ color: event.target.value })} /></label><span style={{ background: effects.impact.color }} /></div>
          <label className="field-label">Size <span>{effects.impact.size.toFixed(1)}x</span><input type="range" min=".4" max="3" step=".1" value={effects.impact.size} onChange={(event) => updateImpact({ size: Number(event.target.value) })} /></label>
        </details>
        <button className="secondary-generator-button dice-effect-preview-button" onClick={() => setEffectPreviewKey((value) => value + 1)}><Orbit size={14} /> Preview roll effects</button>
        <button className="primary-button" disabled={working || !theme.name.trim()} onClick={() => void save()}><Save size={15} /> Use this theme for d{sides}</button>
        <button className="secondary-generator-button" disabled={!themes.some((entry) => entry.id === theme.id)} onClick={assignSet}><Dices size={14} /> Use for complete set</button>
        <p className="dice-assignment-status">d{sides}: {assignments[`d${sides}`] === theme.id ? <><Check size={12} /> This theme is active</> : "Theme autosaved · assign it to use at the table"}</p>
      </aside>
    </div>
    {catalogueOpen && <AssetCatalogueDialog
      ariaLabel="Dice set catalogue"
      eyebrow={<><Archive size={13} /> Local dice set catalogue</>}
      title="Choose a saved dice set"
      description="Search saved materials and effects, reopen one in Dice Forge, or assign it to one die or the complete tabletop set."
      searchPlaceholder="Search dice sets, materials, or effects"
      onClose={() => setCatalogueOpen(false)}
      empty={<div className="miniature-library-empty"><Dices size={28} /><strong>No saved dice sets yet</strong><small>Your current theme autosaves as soon as you begin designing it.</small></div>}
      items={themes.map((entry) => ({
        id: entry.id,
        name: entry.name,
        searchText: `${entry.description} ${entry.effectPrompt ?? ""} ${entry.source}`,
        preview: <DiceThemeAssetPreview theme={entry} />,
        details: <>{Object.keys(entry.maps).length} PBR maps · {entry.source} · {resolveDiceEffects(entry.effects).particles.enabled ? "particles" : "static"}</>,
        active: entry.id === theme.id,
        inCampaign: campaignThemes.some((candidate) => candidate.id === entry.id),
        actions: <><button onClick={() => { loadTheme(entry); setCatalogueOpen(false); }}><Edit3 size={14} /> Open in editor</button><button className="primary-button" onClick={() => { loadTheme(entry); assignDiceTheme(sides, entry.id); setCatalogueOpen(false); onNotify(`${entry.name} assigned to d${sides}.`, "success"); }}><Dices size={14} /> Use for d{sides}</button><button onClick={() => { diceSides.forEach((die) => assignDiceTheme(die, entry.id)); onNotify(`${entry.name} assigned to the complete dice set.`, "success"); }}><Check size={14} /> Use complete set</button><button className="catalogue-delete-button" onClick={() => { removeDiceTheme(entry.id); if (entry.id === theme.id) startNew(); }}><Trash2 size={14} /> Delete saved set</button></>,
        status: entry.id === theme.id ? <span className="campaign-token-status"><Check size={12} /> Editing</span> : undefined,
      }))}
    />}
    <p className="local-only-note">Dice textures and generated PBR maps stay on this computer. Cloud generation is opt-in: export the template and prompt, use your chosen service, then import the result.</p>
  </section>;
}
