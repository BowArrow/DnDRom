import { Archive, ArrowLeft, Box, Check, Edit3, ImagePlus, LampWallUp, Layers3, LoaderCircle, MinusCircle, Rotate3D, Save, Sparkles, Trash2, Upload, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateCharacterGlb } from "../ai/character3dClient";
import { loadBundledWorkflow } from "../ai/comfyWorkflowPreset";
import { ensureLocalRuntime, runtimeProgressPercent } from "../ai/localRuntime";
import { generateHostedKreaCandidate, generateLocalPropCandidate, resolvePropImageRoute } from "../ai/propImageClient";
import { compileMaterialPrompt, compileObjectPropPrompt, promptAttribution } from "../ai/propPrompt";
import { deriveMaterialMaps } from "../domain/materialProcessing";
import type { AttachmentProfile, AttachmentSurface, AttachmentSurfaceKind, MaterialAsset, MaterialTarget, PropBehavior } from "../domain/types";
import { storeMaterialMap } from "../persistence/materialAssets";
import { DEFAULT_PROP_TRIANGLES, getStoredPropModel, storePropModel } from "../persistence/propAssets";
import { useCampaignStore } from "../state/campaignStore";
import { GenerationProgress, type GenerationProgressView } from "./GenerationProgress";
import { TokenModelPreview } from "./TokenModelPreview";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";
import { PropAssetPreview } from "./StoredAssetPreview";

interface PropForgeProps { onBack: () => void; onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void; requestedAssetId?: string | null; initialRequest?: { name: string; description: string; kind: "object" | "material" } | null }
type Provider = "sana-local" | "krea-local" | "krea-cloud";
const profileKinds: Record<AttachmentProfile, AttachmentSurfaceKind[]> = { tabletop: ["tabletop", "stack-top"], "floor-standing": ["floor", "tabletop", "stack-top"], "wall-mounted": ["wall"], "ceiling-hanging": ["ceiling"], stackable: ["floor", "tabletop", "stack-top"], structural: ["floor", "structural-edge"] };
const profileSurfaces = (profile: AttachmentProfile): AttachmentSurface[] => profile === "stackable" ? [{ id: "top", name: "Stacking top", kind: "stack-top", position: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 1, z: 0 }, tangent: { x: 1, y: 0, z: 0 }, bitangent: { x: 0, y: 0, z: 1 }, halfSize: { x: .5, y: .5 }, accepts: ["stackable", "tabletop"] }] : [];
const targetProjection = (target: MaterialTarget): MaterialAsset["projection"] => target === "floor" ? "planar-xz" : target === "wall" ? "planar-xy" : target === "pillar" ? "triplanar" : "uv";

export function PropForge({ onBack, onNotify, requestedAssetId, initialRequest }: PropForgeProps) {
  const campaign = useCampaignStore((state) => state.campaign);
  const library = useCampaignStore((state) => state.propLibrary);
  const savePropAsset = useCampaignStore((state) => state.savePropAsset);
  const addPropToCampaign = useCampaignStore((state) => state.addPropToCampaign);
  const removePropFromCampaign = useCampaignStore((state) => state.removePropFromCampaign);
  const removePropAsset = useCampaignStore((state) => state.removePropAsset);
  const saveMaterialAsset = useCampaignStore((state) => state.saveMaterialAsset);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const [kind, setKind] = useState<"object" | "material">(initialRequest?.kind ?? "object");
  const [name, setName] = useState(initialRequest?.name ?? "New tabletop prop");
  const [description, setDescription] = useState(initialRequest?.description ?? "A hand-painted ceramic potion bottle with a cork stopper");
  const [provider, setProvider] = useState<Provider>(campaign.settings.propImageProvider ?? "sana-local");
  const [profile, setProfile] = useState<AttachmentProfile>("floor-standing");
  const [materialTarget, setMaterialTarget] = useState<MaterialTarget>("floor");
  const [materialClass, setMaterialClass] = useState<MaterialAsset["materialClass"]>("wood");
  const [targetFaces, setTargetFaces] = useState(DEFAULT_PROP_TRIANGLES);
  const [candidates, setCandidates] = useState<Array<{ file: File; url: string }>>([]);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [approved, setApproved] = useState(false);
  const [model, setModel] = useState<File | null>(null);
  const [forward, setForward] = useState(0);
  const [lightEnabled, setLightEnabled] = useState(false);
  const [lightType, setLightType] = useState<"point" | "spot">("point");
  const [lightColor, setLightColor] = useState("#ff9b45");
  const [materialScale, setMaterialScale] = useState(1);
  const [materialRotation, setMaterialRotation] = useState(0);
  const [normalStrength, setNormalStrength] = useState(1);
  const [roughness, setRoughness] = useState(.7);
  const [metallic, setMetallic] = useState(0);
  const [mapOverrides, setMapOverrides] = useState<Partial<Record<"albedo" | "normal" | "roughness" | "metallic" | "ambientOcclusion", File>>>({});
  const [working, setWorking] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(requestedAssetId ?? null);
  const [progress, setProgress] = useState<GenerationProgressView | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const glbRef = useRef<HTMLInputElement>(null);
  const selected = candidates[selectedCandidate]?.file ?? null;
  const prompt = useMemo(() => kind === "object" ? compileObjectPropPrompt(description) : compileMaterialPrompt(description, materialTarget), [description, kind, materialTarget]);

  useEffect(() => () => candidates.forEach((entry) => URL.revokeObjectURL(entry.url)), [candidates]);
  useEffect(() => {
    if (!editingAssetId) return;
    const asset = library.find((entry) => entry.id === editingAssetId);
    if (asset) {
      setName(asset.name); setDescription(asset.description); setProfile(asset.profile); setForward(Math.atan2(asset.forwardAnchor.x, -asset.forwardAnchor.z) * 180 / Math.PI); setLightEnabled(asset.defaultBehavior.kind === "practical-light");
      void getStoredPropModel(asset.storageKey).then((bytes) => bytes && setModel(new File([bytes], asset.filename, { type: "model/gltf-binary" })));
    }
  }, [editingAssetId, library]);

  const acceptImages = (files: File[]) => {
    const valid = files.filter((file) => file.type.startsWith("image/") && file.size <= 20 * 1024 * 1024).slice(0, 2);
    if (!valid.length) { onNotify("Use PNG, JPEG, or WebP images under 20 MB.", "error"); return; }
    setCandidates((old) => { old.forEach((entry) => URL.revokeObjectURL(entry.url)); return valid.map((file) => ({ file, url: URL.createObjectURL(file) })); });
    setSelectedCandidate(0); setApproved(false); setModel(null);
  };

  const generateReferences = async () => {
    const controller = new AbortController(); abortRef.current = controller;
    setWorking(true); setApproved(false); setModel(null); const startedAt = Date.now();
    try {
      const generated: File[] = [];
      if (provider === "krea-cloud") {
        setProgress({ status: "running", message: "Submitting two separately billed Krea jobs", percent: 8, startedAt, stageLabel: "Reference generation" });
        generated.push(await generateHostedKreaCandidate(prompt, controller.signal), await generateHostedKreaCandidate(prompt, controller.signal));
      } else {
        if (provider === "krea-local" && !campaign.settings.kreaCommunityLicenseAcceptedAt) throw new Error("Accept the Krea 2 community license under Settings → AI Providers before installing the optional local pack");
        const route = resolvePropImageRoute(provider);
        const runtime = await ensureLocalRuntime(route.feature!, (event) => setProgress({ status: "running", message: event.message, percent: Math.max(2, Math.round(runtimeProgressPercent(event) * .18)), startedAt, stageLabel: "Local image pack" }));
        updateSettings({ comfyUiEndpoint: runtime.endpoint, propImageProvider: provider });
        const workflow = await loadBundledWorkflow(route.workflow!);
        for (let index = 0; index < 2; index++) generated.push(await generateLocalPropCandidate(runtime.endpoint, prompt, workflow, index, controller.signal, (event) => setProgress({ status: "running", message: event.message, percent: Math.round(20 + index * 35 + event.percent * .34), startedAt, stageLabel: `Candidate ${index + 1} of 2`, reportedByEngine: event.reportedByEngine })));
      }
      acceptImages(generated); setProgress({ status: "complete", message: "Two references are ready. Approve one before creating 3D.", percent: 100, startedAt, stageLabel: "Human review required" });
    } catch (error) { const cancelled = error instanceof DOMException && error.name === "AbortError"; const message = cancelled ? "Reference generation cancelled" : error instanceof Error ? error.message : "Reference generation failed"; if (!cancelled) onNotify(message, "error"); setProgress(cancelled ? null : { status: "error", message, percent: 0, startedAt, stageLabel: "Generation stopped" }); }
    finally { if (abortRef.current === controller) abortRef.current = null; setWorking(false); }
  };

  const create3d = async () => {
    if (!selected || !approved) { onNotify("Approve one reference before starting image-to-3D.", "warning"); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setWorking(true); const startedAt = Date.now();
    try {
      const runtime = await ensureLocalRuntime("characterPixal3d", (event) => setProgress({ status: "running", message: event.message, percent: Math.round(runtimeProgressPercent(event) * .2), startedAt, stageLabel: "Pixal3D setup" }));
      const workflow = await loadBundledWorkflow("/workflows/pixal3d-character.json");
      const glb = await generateCharacterGlb(runtime.endpoint, selected, workflow, { provider: "pixal3d", targetFaces }, controller.signal, (event) => setProgress({ status: "running", message: event.message.replace(/character/gi, "prop"), percent: Math.min(96, event.percent), startedAt, stageLabel: "Image to 3D", reportedByEngine: event.reportedByEngine }));
      setModel(glb); setProgress({ status: "running", message: "GLB downloaded. Review orientation and save to validate it.", percent: 98, startedAt, stageLabel: "Validation pending" });
    } catch (error) { const cancelled = error instanceof DOMException && error.name === "AbortError"; const message = cancelled ? "3D generation cancelled" : error instanceof Error ? error.message : "3D generation failed"; if (!cancelled) onNotify(message, "error"); setProgress(cancelled ? null : { status: "error", message, percent: 0, startedAt, stageLabel: "Generation stopped" }); }
    finally { if (abortRef.current === controller) abortRef.current = null; setWorking(false); }
  };

  const saveObject = async () => {
    if (!model) { onNotify("Generate or import a GLB first.", "warning"); return; }
    setWorking(true); const startedAt = Date.now();
    try {
      const radians = forward * Math.PI / 180;
      const behavior: PropBehavior = lightEnabled ? { kind: "practical-light", lightType, color: lightColor, intensity: 2, range: 7, coneAngle: 50, anchor: { x: 0, y: .6, z: 0 }, direction: { x: Math.sin(radians), y: 0, z: -Math.cos(radians) }, flicker: { enabled: true, amount: .12, speed: 7 } } : { kind: "static" };
      const created = await storePropModel(model, { name, description, source: selected ? "pixal3d" : "import", profile, acceptedSurfaceTags: profileKinds[profile], providedSurfaces: profileSurfaces(profile), collisionMode: "solid", forwardAnchor: { x: Math.sin(radians), y: 0, z: -Math.cos(radians) }, behavior, sourceImage: selected, prompt });
      const previous = editingAssetId ? library.find((entry) => entry.id === editingAssetId) : undefined;
      const asset = previous ? { ...created, id: previous.id, createdAt: previous.createdAt, revisions: [...created.revisions, ...previous.revisions].slice(0, 8) } : created;
      savePropAsset(asset); setEditingAssetId(asset.id); useCampaignStore.getState().setActiveAsset(asset.id);
      setProgress({ status: "complete", message: "Validated prop saved to the reusable catalogue", percent: 100, startedAt, stageLabel: "Complete" }); onNotify(`${asset.name} is saved and ready to place.`, "success");
    } catch (error) { const message = error instanceof Error ? error.message : "Could not save prop"; onNotify(message, "error"); setProgress({ status: "error", message, percent: 98, startedAt, stageLabel: "Validation failed" }); }
    finally { setWorking(false); }
  };

  const saveMaterial = async () => {
    if (!selected) { onNotify("Choose or generate an albedo image first.", "warning"); return; }
    setWorking(true); const startedAt = Date.now();
    try {
      setProgress({ status: "running", message: "Checking seams and deriving editable OpenGL PBR maps", percent: 82, startedAt, stageLabel: "PBR processing" });
      const maps = await deriveMaterialMaps(mapOverrides.albedo ?? selected, materialClass, normalStrength);
      const stored = { albedo: await storeMaterialMap(mapOverrides.albedo ?? maps.albedo), normal: await storeMaterialMap(mapOverrides.normal ?? maps.normal), roughness: await storeMaterialMap(mapOverrides.roughness ?? maps.roughness), metallic: await storeMaterialMap(mapOverrides.metallic ?? maps.metallic), ambientOcclusion: await storeMaterialMap(mapOverrides.ambientOcclusion ?? maps.ambientOcclusion) };
      const now = new Date().toISOString();
      const asset: MaterialAsset = { id: `material-custom-${crypto.randomUUID()}`, name: name.trim() || "Custom material", description, target: materialTarget, materialClass, maps: stored, projection: targetProjection(materialTarget), scale: materialScale, rotation: materialRotation, normalStrength, roughness, metallic, seamScore: maps.seamScore, source: provider === "krea-cloud" ? "cloud-ai" : selected ? "local-ai" : "import", prompt, revisions: [{ id: crypto.randomUUID(), maps: stored, createdAt: now, prompt }], createdAt: now, updatedAt: now };
      saveMaterialAsset(asset); setProgress({ status: "complete", message: `Material saved. Seam continuity ${(maps.seamScore * 100).toFixed(0)}%.`, percent: 100, startedAt, stageLabel: "Complete" }); onNotify(`${asset.name} is available for modular geometry.`, "success");
    } catch (error) { const message = error instanceof Error ? error.message : "Could not save material"; onNotify(message, "error"); setProgress({ status: "error", message, percent: 0, startedAt, stageLabel: "Material processing stopped" }); }
    finally { setWorking(false); }
  };

  return <section className="prop-forge-page">
    <header className="creator-studio-header"><button onClick={onBack}><ArrowLeft size={16} /> Board</button><div><span className="eyebrow"><WandSparkles size={13} /> Local-first asset creation</span><h1>Prop Forge</h1><p>Review a clean reference, create a bounded gameplay mesh, then author how it attaches.</p></div><button className="forge-catalogue-button" onClick={() => setCatalogueOpen(true)}><Archive size={14} /><span>Prop catalogue</span><small>{library.length} saved</small></button></header>
    <div className="prop-forge-layout">
      <aside className="prop-forge-panel fantasy-panel"><div className="panel-title-row"><div><span className="eyebrow">Source design</span><h2>Describe or upload</h2></div><ImagePlus size={18} /></div>
        <div className="segmented-control"><button className={kind === "object" ? "active" : ""} onClick={() => setKind("object")}><Box size={14} /> Object prop</button><button className={kind === "material" ? "active" : ""} onClick={() => setKind("material")}><Layers3 size={14} /> Material</button></div>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {kind === "material" && <><label>Geometry target<select value={materialTarget} onChange={(event) => setMaterialTarget(event.target.value as MaterialTarget)}>{["floor", "wall", "pillar", "general"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Material class<select value={materialClass} onChange={(event) => setMaterialClass(event.target.value as MaterialAsset["materialClass"])}>{["wood", "stone", "metal", "painted", "fabric", "general"].map((value) => <option key={value}>{value}</option>)}</select></label></>}
        <label>Image provider<select value={provider} onChange={(event) => { setProvider(event.target.value as Provider); updateSettings({ propImageProvider: event.target.value as Provider }); }}><option value="sana-local">Sana 1.5 Lite · local</option><option value="krea-local">Krea 2 Turbo · local high-end</option><option value="krea-cloud">Krea API · hosted / separate billing</option></select></label>
        <button className="primary-button" disabled={working || !description.trim()} onClick={() => void generateReferences()}>{working ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} {candidates.length ? "Generate two more" : "Generate two references"}</button>
        {working && <button onClick={() => abortRef.current?.abort()}>Cancel current job</button>}
        <button onClick={() => uploadRef.current?.click()}><Upload size={15} /> Upload reference</button><input ref={uploadRef} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => acceptImages([...event.target.files ?? []])} />
        <small className="forge-attribution">{promptAttribution(provider)} · only the explicit asset prompt is sent.</small>
      </aside>
      <main className="prop-forge-stage fantasy-panel"><div className="prop-reference-grid">{candidates.map((candidate, index) => <button key={candidate.url} className={selectedCandidate === index ? "active" : ""} onClick={() => { setSelectedCandidate(index); setApproved(false); }}><img src={candidate.url} alt={`Generated reference candidate ${index + 1}`} /><span>Candidate {index + 1}</span></button>)}</div>
        {!candidates.length && !model && <div className="forge-empty"><Box size={52} /><strong>Two reviewed references appear here</strong><p>Upload your own art or generate two isolated candidates.</p></div>}
        {selected && !model && <div className="reference-review"><img src={candidates[selectedCandidate].url} alt="Selected prop reference" /><button className={approved ? "approved" : "primary-button"} onClick={() => setApproved((value) => !value)}><Check size={15} /> {approved ? "Approved for conversion" : "Approve this reference"}</button>{kind === "object" && <button disabled={!approved || working} onClick={() => void create3d()}><Rotate3D size={15} /> Create 3D prop</button>}</div>}
        {model && <TokenModelPreview model={model} kind="enemy" shape="round" baseColor="#201710" accentColor="#bf9636" footprint={.7} modelScale={1} placementScale={1} />}
        {progress && <GenerationProgress value={progress} label="Prop generation progress" />}
      </main>
      <aside className="prop-forge-panel fantasy-panel"><div className="panel-title-row"><div><span className="eyebrow">Placement profile</span><h2>Runtime behavior</h2></div><LampWallUp size={18} /></div>
        {kind === "object" ? <><label>Attachment<select value={profile} onChange={(event) => setProfile(event.target.value as AttachmentProfile)}>{Object.keys(profileKinds).map((value) => <option key={value}>{value}</option>)}</select></label><label>Target triangles <output>{targetFaces.toLocaleString()}</output><input type="range" min="2000" max="20000" step="1000" value={targetFaces} onChange={(event) => setTargetFaces(Number(event.target.value))} /></label><label>Forward direction <output>{forward}°</output><input type="range" min="-180" max="180" step="15" value={forward} onChange={(event) => setForward(Number(event.target.value))} /></label><label className="check-row"><input type="checkbox" checked={lightEnabled} onChange={(event) => setLightEnabled(event.target.checked)} /> Practical light</label>{lightEnabled && <><label>Light type<select value={lightType} onChange={(event) => setLightType(event.target.value as "point" | "spot")}><option>point</option><option>spot</option></select></label><label>Light color<input type="color" value={lightColor} onChange={(event) => setLightColor(event.target.value)} /></label></>}<button onClick={() => glbRef.current?.click()}><Upload size={15} /> Import self-contained GLB</button><input ref={glbRef} hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => setModel(event.target.files?.[0] ?? null)} /><button className="primary-button" disabled={!model || working} onClick={() => void saveObject()}><Save size={15} /> Validate and save prop</button></> : <><p className="forge-guidance">Projection: <strong>{targetProjection(materialTarget)}</strong>. Maps remain replaceable; these controls multiply authored data.</p><label>Material scale <output>{materialScale.toFixed(2)}</output><input type="range" min=".1" max="8" step=".1" value={materialScale} onChange={(event) => setMaterialScale(Number(event.target.value))} /></label><label>Rotation <output>{materialRotation}°</output><input type="range" min="0" max="360" step="15" value={materialRotation} onChange={(event) => setMaterialRotation(Number(event.target.value))} /></label><label>Normal strength <output>{normalStrength.toFixed(2)}</output><input type="range" min="0" max="2" step=".05" value={normalStrength} onChange={(event) => setNormalStrength(Number(event.target.value))} /></label><label>Roughness <output>{roughness.toFixed(2)}</output><input type="range" min="0" max="1" step=".02" value={roughness} onChange={(event) => setRoughness(Number(event.target.value))} /></label><label>Metallic <output>{metallic.toFixed(2)}</output><input type="range" min="0" max="1" step=".02" value={metallic} onChange={(event) => setMetallic(Number(event.target.value))} /></label><div className="pbr-override-grid">{(["albedo", "normal", "roughness", "metallic", "ambientOcclusion"] as const).map((slot) => <label key={slot} className={mapOverrides[slot] ? "loaded" : ""}>{slot}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) setMapOverrides((value) => ({ ...value, [slot]: file })); }} /></label>)}</div><button className="primary-button" disabled={!selected || working} onClick={() => void saveMaterial()}><Save size={15} /> Build and save PBR material</button></>}
      </aside>
    </div>
    {catalogueOpen && <AssetCatalogueDialog
      ariaLabel="Prop catalogue"
      eyebrow={<><Archive size={13} /> Local prop catalogue</>}
      title="Choose a saved prop"
      description="Search reusable props, inspect their approved source image, reopen one for editing, or add it to the current campaign."
      searchPlaceholder="Search props, placement types, or descriptions"
      onClose={() => setCatalogueOpen(false)}
      empty={<div className="miniature-library-empty"><Box size={28} /><strong>No saved props yet</strong><small>Generate or import a prop, then validate and save it.</small></div>}
      items={library.map((asset) => {
        const inCampaign = Boolean(campaign.propAssets?.some((entry) => entry.id === asset.id));
        return {
          id: asset.id,
          name: asset.name,
          searchText: `${asset.description} ${asset.profile} ${asset.source}`,
          preview: <PropAssetPreview asset={asset} />,
          details: <>{asset.profile} · {asset.triangleCount.toLocaleString()} triangles · {asset.revisions.length} revisions</>,
          active: editingAssetId === asset.id,
          inCampaign,
          actions: <><button onClick={() => { setEditingAssetId(asset.id); setCatalogueOpen(false); }}><Edit3 size={14} /> Open in editor</button>{inCampaign ? <button className="remove-campaign-token" onClick={() => removePropFromCampaign(asset.id)}><MinusCircle size={14} /> Remove from campaign</button> : <button className="primary-button" onClick={() => addPropToCampaign(asset.id)}><Check size={14} /> Add to campaign</button>}<button className="catalogue-delete-button" onClick={() => { removePropAsset(asset.id); if (editingAssetId === asset.id) setEditingAssetId(null); }}><Trash2 size={14} /> Delete saved prop</button></>,
          status: inCampaign ? <span className="campaign-token-status"><Check size={12} /> In campaign</span> : undefined,
        };
      })}
    />}
  </section>;
}
