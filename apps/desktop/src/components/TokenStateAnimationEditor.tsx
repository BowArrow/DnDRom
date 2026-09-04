import { useState } from "react";
import { Activity, Copy, Download, Plus, RotateCcw, Sparkles, Trash2, Upload, WandSparkles } from "lucide-react";
import type { CharacterRigProfile } from "../ai/characterRigClient";
import { compileTokenAnimation } from "../domain/tokenAnimation";
import type { TokenAnimation, TokenAnimationKind } from "../domain/types";

export interface ForgeAnimationDraft extends TokenAnimation {
  draftFile?: File | null;
  fileSlot?: `character-animation-${string}`;
}

export interface ForgeModelRevisionDraft {
  id: string;
  model: File | null;
  fileSlot: `character-revision-${string}`;
  createdAt: string;
  prompt?: string;
  source: "generated" | "prompt-edit" | "paint" | "import";
}

export interface ForgeTokenStateDraft {
  id: string;
  formId?: string;
  name: string;
  styleName?: string;
  model: File | null;
  modelSlot?: `character-state-${string}`;
  riggedModel?: File | null;
  rigSlot?: `character-rig-${string}`;
  rigProfile?: CharacterRigProfile;
  rigCreatedAt?: string;
  animations: ForgeAnimationDraft[];
  revisions?: ForgeModelRevisionDraft[];
}

interface TokenStateAnimationEditorProps {
  states: ForgeTokenStateDraft[];
  activeStateId: string;
  defaultModel: File | null;
  rigReady: boolean;
  busy: boolean;
  onActiveStateChange: (id: string) => void;
  onStatesChange: (states: ForgeTokenStateDraft[]) => void;
  onModelReplace: (stateId: string, file: File) => void;
  onGenerateMotion: (stateId: string, animationId: string) => void;
  onRestoreRevision: (stateId: string, revisionId: string) => void;
}

const kinds: TokenAnimationKind[] = ["idle", "attack", "ability", "reaction", "transform"];

export function TokenStateAnimationEditor({ states, activeStateId, defaultModel, rigReady, busy, onActiveStateChange, onStatesChange, onModelReplace, onGenerateMotion, onRestoreRevision }: TokenStateAnimationEditorProps) {
  const [reuseMotionId, setReuseMotionId] = useState("");
  const active = states.find((state) => state.id === activeStateId) ?? states[0];
  if (!active) return null;
  const activeFormId = active.formId ?? active.id;
  const forms = [...new Map(states.map((state) => [state.formId ?? state.id, state])).entries()];
  const styles = states.filter((state) => (state.formId ?? state.id) === activeFormId);
  const reusableMotions = states.flatMap((state) => state.animations.map((animation) => ({ state, animation }))).filter(({ state, animation }) => state.id !== active.id || !active.animations.some((entry) => entry.id === animation.id));
  const replaceActive = (update: Partial<ForgeTokenStateDraft>) => onStatesChange(states.map((state) => state.id === active.id ? { ...state, ...update } : state));
  const updateAnimation = (id: string, update: Partial<ForgeAnimationDraft>) => replaceActive({ animations: active.animations.map((animation) => animation.id === id ? { ...animation, ...update } : animation) });
  const compileAnimation = (animation: ForgeAnimationDraft) => updateAnimation(animation.id, compileTokenAnimation(animation.prompt, animation.kind, animation));
  const addAnimation = () => {
    const animation = compileTokenAnimation("Describe how this miniature should move", "ability", { name: "New action", loop: false }) as ForgeAnimationDraft;
    replaceActive({ animations: [...active.animations, animation] });
  };
  const addState = (file?: File) => {
    if (!file) return;
    const id = `token-state-${crypto.randomUUID()}`;
    const state: ForgeTokenStateDraft = { id, formId: id, name: file.name.replace(/\.glb$/i, "") || "Alternate form", styleName: "Classic", model: file, modelSlot: `character-state-${id}`, riggedModel: null, rigProfile: "humanoid", animations: [], revisions: [] };
    onStatesChange([...states, state]);
    onActiveStateChange(id);
  };
  const addStyle = () => {
    const id = `token-state-${crypto.randomUUID()}`;
    const style: ForgeTokenStateDraft = {
      ...active,
      id,
      formId: activeFormId,
      styleName: `Style ${styles.length + 1}`,
      model: active.model ?? (states.indexOf(active) === 0 ? defaultModel : null),
      modelSlot: `character-state-${id}`,
      rigSlot: active.riggedModel ? `character-rig-${id}` : undefined,
      animations: active.animations.map((animation) => ({ ...animation, id: `token-animation-${crypto.randomUUID()}`, sourceFile: undefined, draftFile: animation.draftFile ?? null, fileSlot: animation.draftFile ? `character-animation-${crypto.randomUUID()}` : undefined })),
      revisions: [],
    };
    onStatesChange([...states, style]);
    onActiveStateChange(id);
  };
  const reuseMotion = () => {
    const source = reusableMotions.find(({ animation }) => animation.id === reuseMotionId);
    if (!source) return;
    const id = `token-animation-${crypto.randomUUID()}`;
    const duplicate: ForgeAnimationDraft = {
      ...source.animation,
      id,
      name: source.animation.name,
      draftFile: source.animation.draftFile ?? null,
      fileSlot: source.animation.draftFile ? `character-animation-${id}` : undefined,
    };
    replaceActive({ animations: [...active.animations, duplicate] });
    setReuseMotionId("");
  };

  return <section className="token-state-editor" aria-label="Token forms and animations">
    <div className="sidebar-section-heading"><WandSparkles size={14} /><span><strong>Forms & animation</strong><small>Shapeshifts, power-ups, idle loops, and attacks</small></span></div>
    <div className="token-state-tabs" role="tablist" aria-label="Token forms">
      {forms.map(([formId, state], index) => <button key={formId} role="tab" aria-selected={formId === activeFormId} className={formId === activeFormId ? "active" : ""} onClick={() => onActiveStateChange(states.find((entry) => (entry.formId ?? entry.id) === formId)?.id ?? state.id)}><span>{state.name}</span><small>{index === 0 ? "Default form" : `${states.filter((entry) => (entry.formId ?? entry.id) === formId).length} styles`}</small></button>)}
      <label className="icon-tooltip add-state-button" data-tooltip="Import another GLB form" aria-label="Import another token form"><Plus size={15} /><input hidden type="file" accept=".glb,model/gltf-binary" onChange={(event) => { addState(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
    </div>
    <div className="token-style-tabs" role="tablist" aria-label="Token styles">
      {styles.map((style) => <button key={style.id} role="tab" aria-selected={style.id === active.id} className={style.id === active.id ? "active" : ""} onClick={() => onActiveStateChange(style.id)}><span>{style.styleName ?? "Classic"}</span><small>{(style.revisions?.length ?? 0) + 1} versions</small></button>)}
      <button className="icon-tooltip add-style-button" data-tooltip="Create a new style using this form and its motions" aria-label="Add token style" onClick={addStyle}><Plus size={14} /> Style</button>
    </div>
    <div className="token-state-properties">
      <label className="field-label">Form name<input value={active.name} onChange={(event) => { const name = event.target.value; onStatesChange(states.map((state) => (state.formId ?? state.id) === activeFormId ? { ...state, name } : state)); }} /></label>
      <label className="field-label">Style name<input value={active.styleName ?? "Classic"} onChange={(event) => replaceActive({ styleName: event.target.value })} /></label>
      <label className="workflow-picker compact"><Upload size={14} /><span>{active.model?.name ?? (states.indexOf(active) === 0 ? "Uses the current miniature" : "Choose this form's GLB")}</span><input type="file" accept=".glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0]; if (file) onModelReplace(active.id, file); event.currentTarget.value = ""; }} /></label>
      {states.indexOf(active) > 0 && <button className="text-button danger-text" onClick={() => { const removeIds = styles.length > 1 ? new Set([active.id]) : new Set(styles.map((style) => style.id)); const remaining = states.filter((state) => !removeIds.has(state.id)); onStatesChange(remaining); onActiveStateChange(remaining[0].id); }}><Trash2 size={13} /> Remove {styles.length > 1 ? "style" : "form"}</button>}
    </div>
    <div className="token-version-history"><span><strong>Local version history</strong><small>Current + {active.revisions?.length ?? 0} restore points</small></span>{active.revisions?.length ? active.revisions.map((revision, index) => <button key={revision.id} onClick={() => onRestoreRevision(active.id, revision.id)} title={revision.prompt ?? revision.source}><RotateCcw size={12} /> v{(active.revisions?.length ?? 0) - index} <small>{new Date(revision.createdAt).toLocaleString()}</small></button>) : <small>No prior revisions yet. AI edits and model replacements create restore points automatically.</small>}</div>
    <div className="animation-slot-heading"><span><Activity size={14} /><strong>Motion slots</strong></span><button onClick={addAnimation}><Plus size={13} /> Add action</button></div>
    <div className="motion-reuse-row"><select aria-label="Reusable animation" value={reuseMotionId} onChange={(event) => setReuseMotionId(event.target.value)}><option value="">Reuse a motion from another style or form</option>{reusableMotions.map(({ state, animation }) => <option key={`${state.id}:${animation.id}`} value={animation.id}>{state.name} · {state.styleName ?? "Classic"} · {animation.name}</option>)}</select><button onClick={reuseMotion} disabled={!reuseMotionId}><Copy size={13} /> Apply copy</button></div>
    <div className="animation-slot-list">
      {active.animations.length === 0 && <p className="animation-empty">Add an idle, attack, transformation, or special action. Static tokens remain fully supported.</p>}
      {active.animations.map((animation) => <article className="animation-slot" key={animation.id}>
        <div className="animation-slot-title"><input aria-label="Animation name" value={animation.name} onChange={(event) => updateAnimation(animation.id, { name: event.target.value })} /><select aria-label="Animation type" value={animation.kind} onChange={(event) => { const kind = event.target.value as TokenAnimationKind; updateAnimation(animation.id, { kind, loop: kind === "idle" }); }}>{kinds.map((kind) => <option value={kind} key={kind}>{kind}</option>)}</select><button className="icon-tooltip" data-tooltip="Delete animation" aria-label={`Delete ${animation.name}`} onClick={() => replaceActive({ animations: active.animations.filter((entry) => entry.id !== animation.id) })}><Trash2 size={13} /></button></div>
        <textarea aria-label={`${animation.name} movement description`} rows={2} value={animation.prompt} onChange={(event) => updateAnimation(animation.id, { prompt: event.target.value })} onBlur={() => compileAnimation(animation)} placeholder="A low ready stance with subtle breathing and alert head movement" />
        <div className="animation-slot-meta"><span>{animation.motion}</span><label><input type="checkbox" checked={animation.loop} onChange={(event) => updateAnimation(animation.id, { loop: event.target.checked })} /> Loop</label><label>Speed <input type="number" min="0.35" max="12" step="0.1" value={animation.duration} onChange={(event) => updateAnimation(animation.id, { duration: Number(event.target.value) })} /></label></div>
        <div className="animation-slot-actions"><button onClick={() => compileAnimation(animation)}><Sparkles size={13} /> Interpret motion</button><button onClick={() => onGenerateMotion(active.id, animation.id)} disabled={!rigReady || busy || !animation.prompt.trim()} title={rigReady ? "Generate a retargeted HY-Motion FBX with the optional high-end pack" : "Auto-rig the miniature first"}><WandSparkles size={13} /> Generate HY-Motion</button><label><Upload size={13} /> Attach FBX/animated GLB<input hidden type="file" accept=".fbx,.glb,model/gltf-binary" onChange={(event) => { const file = event.target.files?.[0] ?? null; updateAnimation(animation.id, { draftFile: file, fileSlot: file ? `character-animation-${animation.id}` : undefined, source: file ? "import" : "procedural" }); event.currentTarget.value = ""; }} /></label>{animation.draftFile && <button onClick={() => { const url = URL.createObjectURL(animation.draftFile!); const anchor = document.createElement("a"); anchor.href = url; anchor.download = animation.draftFile!.name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000); }}><Download size={13} /> {animation.draftFile.name}</button>}</div>
      </article>)}
    </div>
    <p className="animation-runtime-note">Descriptions configure animation slots, but the tabletop stays static until the character has a real embedded skeletal clip. HY-Motion and imported clips remain attached to their character form.</p>
  </section>;
}
