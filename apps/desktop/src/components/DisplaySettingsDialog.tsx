import { useEffect, useState } from "react";
import { Check, Gauge, KeyRound, MonitorCog, RotateCcw, ScanLine, Sparkles, X } from "lucide-react";
import {
  DEFAULT_DISPLAY_SETTINGS,
  displayPreset,
  type DisplayAntialiasing,
  type DisplayMotion,
  type DisplayQuality,
  type DisplaySettings,
  type DisplayShadowQuality,
  writeDisplaySettings,
} from "../domain/displaySettings";
import type { LightingQuality } from "../domain/types";
import { useDisplaySettings } from "../state/useDisplaySettings";
import { useCampaignStore } from "../state/campaignStore";
import { readLocalAiSettings, writeLocalAiSettings, type LocalAiMemoryProfile } from "../domain/localAiSettings";

interface DisplaySettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const presets: Array<{ id: LightingQuality; title: string; note: string; cost: string }> = [
  { id: "performance", title: "Performance", note: "Lower resolution and lean effects for integrated graphics.", cost: "Fastest" },
  { id: "balanced", title: "Balanced", note: "Smooth TAA, grounded shadows, and crisp tabletop materials.", cost: "Recommended" },
  { id: "cinematic", title: "Cinematic", note: "Macro depth, atmosphere, bloom, and richer contact shading.", cost: "High GPU" },
  { id: "diorama", title: "Diorama", note: "Supersampled macro focus, ultra shadows, dense SSAO, and fog.", cost: "Enthusiast" },
];

export function DisplaySettingsDialog({ open, onClose }: DisplaySettingsDialogProps) {
  const saved = useDisplaySettings();
  const [draft, setDraft] = useState<DisplaySettings>(saved);
  const campaignSettings = useCampaignStore((state) => state.campaign.settings);
  const updateCampaignSettings = useCampaignStore((state) => state.updateSettings);
  const [provider, setProvider] = useState(campaignSettings.propImageProvider ?? "sana-local");
  const [licenseAccepted, setLicenseAccepted] = useState(Boolean(campaignSettings.kreaCommunityLicenseAcceptedAt));
  const [kreaToken, setKreaToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [aiMemoryProfile, setAiMemoryProfile] = useState<LocalAiMemoryProfile>(() => readLocalAiSettings().memoryProfile);

  useEffect(() => {
    if (open) {
      setDraft(saved); setProvider(campaignSettings.propImageProvider ?? "sana-local"); setLicenseAccepted(Boolean(campaignSettings.kreaCommunityLicenseAcceptedAt)); setKreaToken(""); setAiMemoryProfile(readLocalAiSettings().memoryProfile);
      if ("__TAURI_INTERNALS__" in window) void import("@tauri-apps/api/core").then(({ invoke }) => invoke<boolean>("has_krea_api_token")).then(setTokenSaved).catch(() => setTokenSaved(false));
    }
  }, [open, saved, campaignSettings]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open, onClose]);

  if (!open) return null;

  const chooseQuality = (quality: DisplayQuality) => {
    if (quality === "scene") setDraft((value) => ({ ...value, quality }));
    else setDraft(displayPreset(quality));
  };
  const toggle = (key: "ambientOcclusion" | "depthOfField" | "bloom" | "atmosphere") => setDraft((value) => ({ ...value, [key]: !value[key] }));
  const apply = () => {
    writeDisplaySettings(draft);
    writeLocalAiSettings({ memoryProfile: aiMemoryProfile });
    updateCampaignSettings({ propImageProvider: provider, kreaCommunityLicenseAcceptedAt: licenseAccepted ? campaignSettings.kreaCommunityLicenseAcceptedAt ?? new Date().toISOString() : undefined });
    onClose();
  };
  const saveToken = async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_krea_api_token", { token: kreaToken }); setKreaToken(""); setTokenSaved(Boolean(kreaToken.trim()));
  };

  return (
    <div className="display-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="display-settings-dialog fantasy-corners" role="dialog" aria-modal="true" aria-labelledby="display-settings-title">
        <header className="display-settings-header">
          <div className="settings-sigil"><MonitorCog size={23} /></div>
          <div><span className="eyebrow">System settings</span><h2 id="display-settings-title">Display & rendering</h2><p>Choose a ready-made tier, then tune the expensive effects for this computer.</p></div>
          <button className="modal-close" onClick={onClose} aria-label="Close display settings"><X size={18} /></button>
        </header>

        <div className="display-settings-body">
          <section className="settings-section">
            <div className="settings-section-title"><Gauge size={15} /><div><h3>Quality tier</h3><p>Applies to the tabletop, Scene Creator, Character Forge, and Dice Forge.</p></div></div>
            <div className="quality-preset-grid">
              {presets.map((preset) => <button key={preset.id} className={draft.quality === preset.id ? "active" : ""} onClick={() => chooseQuality(preset.id)}>
                <span>{draft.quality === preset.id ? <Check size={14} /> : <i />}</span><strong>{preset.title}</strong><small>{preset.note}</small><em>{preset.cost}</em>
              </button>)}
            </div>
            <button className={`scene-quality-button ${draft.quality === "scene" ? "active" : ""}`} onClick={() => chooseQuality("scene")}><ScanLine size={15} /><span><strong>Use each scene’s quality</strong><small>Respect the quality chosen in each Scene Creator draft.</small></span>{draft.quality === "scene" && <Check size={15} />}</button>
          </section>

          <section className="settings-section ai-provider-settings">
            <div className="settings-section-title"><KeyRound size={15} /><div><h3>AI providers</h3><p>Prop prompts are local by default. Hosted Krea is opt-in and billed separately by Krea.</p></div></div>
            <div className="settings-control-grid">
              <label><span><strong>Local AI world detail</strong><small>Game profiles measure missing geometry first, run only useful camera paths, and cap training/runtime splats. Maximum retains the larger cinematic source.</small></span><select value={aiMemoryProfile} onChange={(event) => setAiMemoryProfile(event.target.value as LocalAiMemoryProfile)}><option value="balanced">Game · adaptive · 8–12 GB</option><option value="conservative">Fast game · one path · shared GPU</option><option value="maximum">Cinematic · adaptive · 16 GB+ GPU</option></select></label>
              <label><span><strong>Prop image provider</strong><small>Sana Lite is the default local pack</small></span><select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="sana-local">Sana 1.5 Lite · local</option><option value="krea-local">Krea 2 Turbo · local high-end</option><option value="krea-cloud">Krea API · hosted</option></select></label>
              <label className="krea-license-check"><span><strong>Krea 2 community license</strong><small>Required for the optional local Krea pack. Includes attribution and prompt/output review requirements.</small></span><span><input type="checkbox" checked={licenseAccepted} onChange={(event) => setLicenseAccepted(event.target.checked)} /> I accept for this device</span></label>
              <label><span><strong>Hosted Krea API token</strong><small>{tokenSaved ? "Saved in Windows Credential Manager" : "No secure token saved"}</small></span><span className="secure-token-row"><input type="password" autoComplete="off" value={kreaToken} placeholder="Paste a workspace token" onChange={(event) => setKreaToken(event.target.value)} /><button type="button" onClick={() => void saveToken()} disabled={!kreaToken.trim()}>Save securely</button></span></label>
            </div>
          </section>

          <section className="settings-section advanced-display-settings">
            <div className="settings-section-title"><Sparkles size={15} /><div><h3>Fine tuning</h3><p>Changes preview immediately after Apply and are saved on this device.</p></div></div>
            <div className="settings-control-grid">
              <label><span><strong>Resolution scale</strong><small>Internal 3D render resolution</small></span><output>{Math.round(draft.resolutionScale * 100)}%</output><input type="range" min="0.5" max="1.25" step="0.05" value={draft.resolutionScale} onChange={(event) => setDraft((value) => ({ ...value, resolutionScale: Number(event.target.value) }))} /></label>
              <label><span><strong>Antialiasing</strong><small>Smooth miniature and grid edges</small></span><select value={draft.antialiasing} onChange={(event) => setDraft((value) => ({ ...value, antialiasing: event.target.value as DisplayAntialiasing }))}><option value="auto">Tier default</option><option value="taa">Temporal AA</option><option value="msaa">Multisample AA</option><option value="off">Off</option></select></label>
              <label><span><strong>Shadow quality</strong><small>Resolution and filtering</small></span><select value={draft.shadowQuality} onChange={(event) => setDraft((value) => ({ ...value, shadowQuality: event.target.value as DisplayShadowQuality }))}><option value="auto">Tier default</option><option value="off">Off</option><option value="low">Low · 1024</option><option value="high">High · 2048</option><option value="ultra">Ultra · 4096</option></select></label>
              <label><span><strong>Motion</strong><small>Turntables and magical movement</small></span><select value={draft.motion} onChange={(event) => setDraft((value) => ({ ...value, motion: event.target.value as DisplayMotion }))}><option value="system">Follow system</option><option value="full">Full motion</option><option value="reduced">Reduced motion</option></select></label>
            </div>
            <div className="display-effect-grid">
              <button className={draft.ambientOcclusion ? "active" : ""} onClick={() => toggle("ambientOcclusion")}><span>{draft.ambientOcclusion && <Check size={12} />}</span><div><strong>Contact shadows</strong><small>SSAO grounds pieces on the board</small></div></button>
              <button className={draft.depthOfField ? "active" : ""} onClick={() => toggle("depthOfField")}><span>{draft.depthOfField && <Check size={12} />}</span><div><strong>Macro depth</strong><small>Tilt-shift miniature focus</small></div></button>
              <button className={draft.bloom ? "active" : ""} onClick={() => toggle("bloom")}><span>{draft.bloom && <Check size={12} />}</span><div><strong>Emissive bloom</strong><small>Magic, torches, and dice effects</small></div></button>
              <button className={draft.atmosphere ? "active" : ""} onClick={() => toggle("atmosphere")}><span>{draft.atmosphere && <Check size={12} />}</span><div><strong>Atmosphere</strong><small>Fog, dust, and environmental depth</small></div></button>
            </div>
          </section>
        </div>

        <footer className="display-settings-footer">
          <button className="settings-reset" onClick={() => setDraft(DEFAULT_DISPLAY_SETTINGS)}><RotateCcw size={14} /> Reset defaults</button>
          <span>Rendering changes are local to this device.</span>
          <div><button onClick={onClose}>Cancel</button><button className="primary-button" onClick={apply}><Check size={15} /> Apply settings</button></div>
        </footer>
      </section>
    </div>
  );
}
