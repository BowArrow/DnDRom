import { Copy, Eye, EyeOff, Lock, RotateCcw, Trash2, Unlock } from "lucide-react";
import { ASSET_BY_ID } from "../domain/assets";
import type { MapEntity } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";

interface EntityInspectorProps {
  entity: MapEntity | null;
}

const numeric = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function EntityInspector({ entity }: EntityInspectorProps) {
  const updateEntity = useCampaignStore((state) => state.updateEntity);
  const removeEntity = useCampaignStore((state) => state.removeEntity);
  const addEntity = useCampaignStore((state) => state.addEntity);

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
  const patchVector = (field: "position" | "rotation" | "scale", axis: "x" | "y" | "z", value: string) => {
    updateEntity(entity.id, { [field]: { ...entity[field], [axis]: numeric(value, entity[field][axis]) } });
  };
  const duplicate = () => addEntity({ ...entity, id: crypto.randomUUID(), name: `${entity.name} copy`, position: { ...entity.position, x: entity.position.x + 1, z: entity.position.z + 1 } });

  return (
    <div className="inspector-content">
      <div className="selected-object-heading">
        <span className="large-asset-icon">{asset?.icon ?? "◇"}</span>
        <div>
          <span className="eyebrow">{asset?.category ?? "Object"}</span>
          <input className="title-input" value={entity.name} onChange={(event) => updateEntity(entity.id, { name: event.target.value })} />
        </div>
      </div>

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

