import { Activity, Copy, Eye, EyeOff, Layers3, Lightbulb, Lock, RotateCcw, Sparkles, Trash2, Unlink, Unlock } from "lucide-react";
import { ASSET_BY_ID } from "../domain/assets";
import { resolveTokenForms, resolveTokenState, resolveTokenStates } from "../domain/tokenAnimation";
import type { MapEntity, PracticalLightBehavior, TokenAsset } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";
import { selectMaterialAssets } from "../state/selectors";

interface EntityInspectorProps {
  entity: MapEntity | null;
  tokenAsset?: TokenAsset;
}

const numeric = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function EntityInspector({ entity, tokenAsset }: EntityInspectorProps) {
  const updateEntity = useCampaignStore((state) => state.updateEntity);
  const removeEntity = useCampaignStore((state) => state.removeEntity);
  const addEntity = useCampaignStore((state) => state.addEntity);
  const materialAssets = useCampaignStore(selectMaterialAssets);
  const mapEntities = useCampaignStore((state) => state.campaign.map.entities);

  if (!entity) {
    return (
      <div className="empty-panel">
        <span className="empty-glyph">◇</span>
        <h3>No object selected</h3>
        <p>Choose Select, then click an object on the tabletop to edit its transform and notes.</p>
      </div>
    );
  }
  const asset = ASSET_BY_ID.get(entity.assetId);
  const inheritedBehavior = asset?.defaultBehavior?.kind === "practical-light" ? asset.defaultBehavior : null;
  const light = entity.light ?? inheritedBehavior;
  const patchVector = (field: "position" | "rotation" | "scale", axis: "x" | "y" | "z", value: string) => {
    updateEntity(entity.id, { [field]: { ...entity[field], [axis]: numeric(value, entity[field][axis]) } });
  };
  const duplicate = () => addEntity({ ...entity, id: crypto.randomUUID(), name: `${entity.name} copy`, position: { ...entity.position, x: entity.position.x + 1, z: entity.position.z + 1 } });
  const setUniformScale = (value: number) => updateEntity(entity.id, { scale: { x: value, y: value, z: value } });
  const tokenStates = tokenAsset ? resolveTokenStates(tokenAsset) : [];
  const tokenState = tokenAsset ? resolveTokenState(tokenAsset, entity.tokenStateId) : null;
  const tokenForms = tokenAsset ? resolveTokenForms(tokenAsset) : [];
  const tokenForm = tokenState ? tokenForms.find((form) => form.id === (tokenState.formId ?? tokenState.id)) : null;
  const parent = entity.build?.parentId ? mapEntities.find((entry) => entry.id === entity.build?.parentId) : undefined;
  const patchLight = (patch: Partial<PracticalLightBehavior>) => {
    if (!light) return;
    updateEntity(entity.id, { light: { ...light, ...patch, kind: "practical-light" } });
  };
  const patchLightVector = (field: "anchor" | "direction", axis: "x" | "y" | "z", value: string) => {
    if (!light) return;
    patchLight({ [field]: { ...light[field], [axis]: numeric(value, light[field][axis]) } });
  };

  return (
    <div className="inspector-content">
      <div className="selected-object-heading">
        <span className="large-asset-icon">{asset?.icon ?? "◇"}</span>
        <div>
          <span className="eyebrow">{asset?.category ?? "Object"}</span>
          <input className="title-input" value={entity.name} onChange={(event) => updateEntity(entity.id, { name: event.target.value })} />
        </div>
      </div>

      {tokenAsset && (
        <>
          <fieldset className="transform-group token-state-controls">
            <legend>Form & animation</legend>
            <label className="field-label">Current form<select value={tokenForm?.id ?? ""} onChange={(event) => { const form = tokenForms.find((entry) => entry.id === event.target.value); updateEntity(entity.id, { tokenStateId: form?.styles[0]?.id, tokenAnimationId: undefined, tokenAnimationStartedAt: undefined }); }}>{tokenForms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
            <label className="field-label">Visual style<select value={tokenState?.id ?? ""} onChange={(event) => updateEntity(entity.id, { tokenStateId: event.target.value, tokenAnimationId: undefined, tokenAnimationStartedAt: undefined })}>{tokenForm?.styles.map((style) => <option key={style.id} value={style.id}>{style.styleName ?? "Classic"}</option>)}</select></label>
            {tokenForms.length > 1 && <p><Sparkles size={12} /> This placed copy can shapeshift independently between {tokenForms.length} saved forms.</p>}
            {(tokenForm?.styles.length ?? 0) > 1 && <p><Sparkles size={12} /> {tokenForm?.styles.length} visual styles share this form while keeping their own rigs and motions.</p>}
            <div className="token-animation-controls">
              {tokenState?.animations.map((animation) => <button key={animation.id} className={entity.tokenAnimationId === animation.id ? "active" : ""} onClick={() => updateEntity(entity.id, { tokenAnimationId: animation.id, tokenAnimationStartedAt: new Date().toISOString() })}><Activity size={13} /><span>{animation.name}<small>{animation.kind} · {animation.motion}</small></span></button>)}
              {!tokenState?.animations.length && <p>No animation slots are attached to this form yet.</p>}
            </div>
          </fieldset>
          <fieldset className="transform-group token-scale-controls">
            <legend>Miniature size</legend>
            <label className="field-label">Uniform scale <span>{entity.scale.x.toFixed(2)}×</span><input type="range" min="0.25" max="4" step="0.05" value={entity.scale.x} onChange={(event) => setUniformScale(Number(event.target.value))} /></label>
            <div className="token-size-presets">
              {[{ label: "Small", value: 0.75 }, { label: "Medium", value: 1 }, { label: "Large", value: 1.5 }, { label: "Huge", value: 2.25 }].map((preset) => <button key={preset.label} className={Math.abs(entity.scale.x - preset.value) < 0.01 ? "active" : ""} onClick={() => setUniformScale(preset.value)}>{preset.label}</button>)}
            </div>
            <p>{tokenAsset.kind} token · {tokenAsset.base.shape} base · {(tokenAsset.footprint * entity.scale.x).toFixed(2)} m footprint</p>
          </fieldset>
        </>
      )}

      {light && (
        <fieldset className="transform-group scene-light-controls">
          <legend><Lightbulb size={12} /> Scene light</legend>
          {asset?.editorOnly && <p className="scene-light-note">The light itself is invisible in Play. Select this build-only gizmo to edit it.</p>}
          <div className="scene-light-row">
            <label className="field-label">Type<select value={light.lightType} onChange={(event) => patchLight({ lightType: event.target.value as PracticalLightBehavior["lightType"] })}><option value="point">Point</option><option value="spot">Spot</option></select></label>
            <label className="field-label scene-light-color">Color<input type="color" value={light.color} onChange={(event) => patchLight({ color: event.target.value })} /></label>
          </div>
          <label className="field-label">Intensity <span>{light.intensity.toFixed(2)}</span><input type="range" min="0" max="12" step="0.05" value={light.intensity} onChange={(event) => patchLight({ intensity: Number(event.target.value) })} /></label>
          <label className="field-label">Range <span>{light.range.toFixed(1)} m</span><input type="range" min="1" max="30" step="0.5" value={light.range} onChange={(event) => patchLight({ range: Number(event.target.value) })} /></label>
          {light.lightType === "spot" && <label className="field-label">Cone <span>{Math.round(light.coneAngle)}°</span><input type="range" min="5" max="120" step="1" value={light.coneAngle} onChange={(event) => patchLight({ coneAngle: Number(event.target.value) })} /></label>}
          <label className="mini-field-heading">Local light height and offset</label>
          <div className="xyz-grid">{(["x", "y", "z"] as const).map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span><input aria-label={`Light anchor ${axis}`} type="number" step="0.1" value={Number(light.anchor[axis].toFixed(2))} onChange={(event) => patchLightVector("anchor", axis, event.target.value)} /></label>)}</div>
          {light.lightType === "spot" && <><label className="mini-field-heading">Local direction</label><div className="xyz-grid">{(["x", "y", "z"] as const).map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span><input aria-label={`Light direction ${axis}`} type="number" step="0.1" value={Number(light.direction[axis].toFixed(2))} onChange={(event) => patchLightVector("direction", axis, event.target.value)} /></label>)}</div></>}
          <label className="scene-light-toggle"><input type="checkbox" checked={Boolean(light.flicker?.enabled)} onChange={(event) => patchLight({ flicker: { enabled: event.target.checked, amount: light.flicker?.amount ?? .1, speed: light.flicker?.speed ?? 5 } })} /><span>Flicker<small>Animate intensity without moving the light</small></span></label>
          {light.flicker?.enabled && <div className="scene-light-row"><label className="field-label">Amount <span>{Math.round(light.flicker.amount * 100)}%</span><input type="range" min="0" max="0.5" step="0.01" value={light.flicker.amount} onChange={(event) => patchLight({ flicker: { ...light.flicker!, amount: Number(event.target.value) } })} /></label><label className="field-label">Speed <span>{light.flicker.speed.toFixed(1)}</span><input type="range" min="0.2" max="20" step="0.2" value={light.flicker.speed} onChange={(event) => patchLight({ flicker: { ...light.flicker!, speed: Number(event.target.value) } })} /></label></div>}
        </fieldset>
      )}

      <fieldset className="transform-group material-attachment-controls">
        <legend><Layers3 size={12} /> Material & support</legend>
        <label className="field-label">Reusable PBR material<select value={entity.materialAssetId ?? ""} onChange={(event) => updateEntity(entity.id, { materialAssetId: event.target.value || undefined })}><option value="">Authored asset material</option>{materialAssets.map((material) => <option key={material.id} value={material.id}>{material.name} · {material.projection}</option>)}</select></label>
        {entity.build?.placementVersion === 2 && entity.build.parentId && <div className="attachment-summary"><span><strong>{parent?.name ?? "Missing support"}</strong><small>{entity.build.surfaceId ?? "surface"} · {entity.build.clearanceOffset.toFixed(4)} m clearance</small></span><button onClick={() => updateEntity(entity.id, { build: { ...entity.build!, parentId: undefined, surfaceId: undefined, localPosition: { ...entity.position }, localRotation: { ...entity.rotation }, surfaceNormal: { x: 0, y: 1, z: 0 }, clearanceOffset: 0, placementVersion: 2 } })}><Unlink size={13} /> Detach</button></div>}
      </fieldset>

      {(["position", "rotation", "scale"] as const).map((field) => (
        <fieldset className="transform-group" key={field}>
          <legend>{field}</legend>
          <div className="xyz-grid">
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis}><span>{axis.toUpperCase()}</span><input type="number" step={field === "rotation" ? 15 : 0.25} value={Number(entity[field][axis].toFixed(2))} onChange={(event) => patchVector(field, axis, event.target.value)} /></label>
            ))}
          </div>
          {field === "rotation" && <button className="text-button" onClick={() => updateEntity(entity.id, { rotation: { x: 0, y: 0, z: 0 } })}><RotateCcw size={13} /> Reset rotation</button>}
        </fieldset>
      ))}

      <label className="field-label">GM notes<textarea rows={4} value={entity.notes ?? ""} onChange={(event) => updateEntity(entity.id, { notes: event.target.value })} placeholder="Secrets, interactions, or context for the AI DM" /></label>

      <div className="inspector-toggles">
        <button onClick={() => updateEntity(entity.id, { hidden: !entity.hidden })}>{entity.hidden ? <EyeOff size={15} /> : <Eye size={15} />}{entity.hidden ? "Hidden" : "Visible"}</button>
        <button onClick={() => updateEntity(entity.id, { locked: !entity.locked })}>{entity.locked ? <Lock size={15} /> : <Unlock size={15} />}{entity.locked ? "Locked" : "Unlocked"}</button>
      </div>
      <div className="inspector-actions">
        <button onClick={duplicate}><Copy size={15} /> Duplicate</button>
        <button className="danger-button" onClick={() => removeEntity(entity.id)}><Trash2 size={15} /> Delete</button>
      </div>
      {asset?.license === "CC0" && <p className="license-note">CC0 asset by Kenney · <a href={asset.source} target="_blank" rel="noreferrer">source</a></p>}
    </div>
  );
}
