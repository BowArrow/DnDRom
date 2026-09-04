import { Copy, FolderOpen, Map, Plus, Trash2, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { campaignCatalog } from "../domain/campaignScenes";
import { generateMapFromPrompt } from "../domain/mapGenerator";
import { useCampaignStore } from "../state/campaignStore";

type Notify = (message: string, tone?: "info" | "success" | "warning" | "error") => void;

export function CampaignNavigator({ onNotify }: { onNotify: Notify }) {
  const campaign = useCampaignStore((state) => state.campaign);
  const archived = useCampaignStore((state) => state.campaignLibrary);
  const renameCampaign = useCampaignStore((state) => state.renameCampaign);
  const createCampaign = useCampaignStore((state) => state.createCampaign);
  const switchCampaign = useCampaignStore((state) => state.switchCampaign);
  const deleteCampaign = useCampaignStore((state) => state.deleteCampaign);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("New Campaign");
  const campaigns = useMemo(() => campaignCatalog(campaign, archived), [campaign, archived]);

  return <div className="campaign-navigator">
    <button className="campaign-current-button" onClick={() => setOpen(true)}><span><small>Campaign</small><strong>{campaign.name}</strong></span><FolderOpen size={14} /></button>
    {open && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="campaign-manager-modal corner-frame" role="dialog" aria-modal="true" aria-label="Campaign library">
        <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
        <span className="eyebrow"><FolderOpen size={13} /> Campaign library</span>
        <h2>Continue an adventure</h2>
        <p>Every campaign, scene, party split, sheet, map edit, DM message, and rules state is autosaved locally.</p>
        <label className="field-label">Current campaign name<input value={campaign.name} onChange={(event) => renameCampaign(event.target.value)} /></label>
        <div className="campaign-create-row"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Campaign name" /><button className="primary-button" onClick={() => { const created = createCampaign(newName); setOpen(false); onNotify(`${created.name} created and ready.`, "success"); }}><Plus size={14} /> New campaign</button></div>
        <div className="campaign-card-list">
          {campaigns.map((entry) => <article key={entry.id} className={entry.id === campaign.id ? "active" : ""}>
            <div><strong>{entry.name}</strong><p>{entry.synopsis}</p><small>{entry.scenes?.length ?? 1} scene{(entry.scenes?.length ?? 1) === 1 ? "" : "s"} · {entry.characters.length} sheet{entry.characters.length === 1 ? "" : "s"} · updated {new Date(entry.updatedAt).toLocaleString()}</small></div>
            {entry.id === campaign.id ? <span>Open now</span> : <><button onClick={() => { switchCampaign(entry.id); setOpen(false); onNotify(`${entry.name} resumed where you left off.`, "success"); }}><FolderOpen size={13} /> Resume</button><button className="danger" aria-label={`Delete ${entry.name}`} onClick={() => { if (window.confirm(`Delete ${entry.name} from this computer? Export it first if you need a backup.`) && deleteCampaign(entry.id)) onNotify(`${entry.name} deleted.`, "warning"); }}><Trash2 size={13} /></button></>}
          </article>)}
        </div>
      </section>
    </div>}
  </div>;
}

export function SceneNavigator({ onNotify }: { onNotify: Notify }) {
  const campaign = useCampaignStore((state) => state.campaign);
  const addScene = useCampaignStore((state) => state.addScene);
  const switchScene = useCampaignStore((state) => state.switchScene);
  const updateScene = useCampaignStore((state) => state.updateScene);
  const deleteScene = useCampaignStore((state) => state.deleteScene);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Split party scene");
  const [copyCurrent, setCopyCurrent] = useState(true);
  const [party, setParty] = useState<string[]>([]);
  const scenes = campaign.scenes ?? [];
  const active = scenes.find((scene) => scene.id === campaign.activeSceneId) ?? scenes[0];

  const create = () => {
    const map = copyCurrent ? structuredClone(campaign.map) : generateMapFromPrompt(`A clean playable ${campaign.map.theme} scene for ${name}`);
    const scene = addScene(name, map, party.length ? party : campaign.characters.filter((character) => (character.role ?? "player") === "player").map((character) => character.id), copyCurrent ? "Branched from the previous scene for a split party." : "New scene.");
    setOpen(false);
    onNotify(`${scene.name} created. The previous scene was saved exactly as it was.`, "success");
  };

  return <div className="scene-navigator">
    <button className="scene-current-button" onClick={() => setOpen(true)}><Map size={14} /><span><small>Scene {Math.max(1, scenes.findIndex((scene) => scene.id === campaign.activeSceneId) + 1)} of {Math.max(1, scenes.length)}</small><strong>{active?.name ?? campaign.map.name}</strong></span></button>
    {open && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="scene-manager-modal corner-frame" role="dialog" aria-modal="true" aria-label="Campaign scenes">
        <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
        <span className="eyebrow"><Map size={13} /> Scene ledger</span>
        <h2>Run parallel scenes</h2>
        <p>Switch between locations or split groups without losing map positions, lighting, placed assets, or party membership.</p>
        <div className="scene-manager-grid">
          <div className="scene-card-list">{scenes.map((scene) => <article key={scene.id} className={scene.id === campaign.activeSceneId ? "active" : ""}>
            <button onClick={() => { switchScene(scene.id); setOpen(false); onNotify(`${scene.name} restored.`, "success"); }}><Map size={14} /><span><strong>{scene.name}</strong><small>{scene.partyCharacterIds.length} character{scene.partyCharacterIds.length === 1 ? "" : "s"} · {scene.map.entities.length} objects</small></span></button>
            {scenes.length > 1 && <button className="danger" aria-label={`Delete scene ${scene.name}`} onClick={() => { if (window.confirm(`Delete the scene ${scene.name}?`) && deleteScene(scene.id)) onNotify(`${scene.name} deleted.`, "warning"); }}><Trash2 size={13} /></button>}
          </article>)}</div>
          <div className="scene-editor-card">
            {active && <><h3>Current scene</h3><label className="field-label">Scene name<input value={active.name} onChange={(event) => updateScene(active.id, { name: event.target.value })} /></label><label className="field-label">DM notes<textarea rows={3} value={active.notes} onChange={(event) => updateScene(active.id, { notes: event.target.value })} /></label><div className="scene-party-picker"><span><Users size={13} /> Party in this scene</span>{campaign.characters.map((character) => <label key={character.id}><input type="checkbox" checked={active.partyCharacterIds.includes(character.id)} onChange={(event) => updateScene(active.id, { partyCharacterIds: event.target.checked ? [...active.partyCharacterIds, character.id] : active.partyCharacterIds.filter((id) => id !== character.id) })} />{character.name}</label>)}</div></>}
            <div className="scene-create-card"><h3>Start another scene</h3><input value={name} onChange={(event) => setName(event.target.value)} /><label><input type="checkbox" checked={copyCurrent} onChange={(event) => setCopyCurrent(event.target.checked)} /><Copy size={12} /> Copy current map and positions</label><div className="scene-party-picker"><span>Characters in new scene</span>{campaign.characters.map((character) => <label key={character.id}><input type="checkbox" checked={party.includes(character.id)} onChange={(event) => setParty((current) => event.target.checked ? [...current, character.id] : current.filter((id) => id !== character.id))} />{character.name}</label>)}</div><button className="primary-button" onClick={create} disabled={!name.trim()}><Plus size={14} /> Create and switch</button></div>
          </div>
        </div>
      </section>
    </div>}
  </div>;
}
