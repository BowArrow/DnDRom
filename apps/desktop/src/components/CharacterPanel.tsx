import { useRef, useState } from "react";
import { Download, Heart, Minus, Moon, Plus, Shield, Sparkles, Sun, Trash2, Upload, UserRound, X } from "lucide-react";
import { importCharacterFile, type CharacterImportResult } from "../importers/characterImport";
import { exportCharacter } from "../persistence/campaignFiles";
import { abilityModifier, formatModifier } from "../domain/rules";
import { DAMAGE_TYPES, proficiencyBonusForLevel, SRD_CONDITIONS } from "../domain/srdRules";
import type { AbilityKey, Character, DamageType } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";
import { selectTokenAssets, selectTokenCharacterLinks } from "../state/selectors";
import { CharacterBuilder } from "./CharacterBuilder";

interface CharacterPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
  showPrivate?: boolean;
}

const abilityLabels: Record<AbilityKey, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
  charisma: "CHA",
};

export function CharacterEditor({ character }: { character: Character }) {
  const updateCharacter = useCampaignStore((state) => state.updateCharacter);
  const damageCharacter = useCampaignStore((state) => state.damageCharacter);
  const healCharacter = useCampaignStore((state) => state.healCharacter);
  const restCharacter = useCampaignStore((state) => state.restCharacter);
  const linkTokenCharacter = useCampaignStore((state) => state.linkTokenCharacter);
  const tokenLinks = useCampaignStore(selectTokenCharacterLinks);
  const tokenAssets = useCampaignStore(selectTokenAssets);
  const attachedTokenId = Object.entries(tokenLinks).find(([, characterId]) => characterId === character.id)?.[0] ?? (tokenAssets.some((token) => token.id === character.tokenAssetId) ? character.tokenAssetId : "");
  const [hpAmount, setHpAmount] = useState(1);
  const [damageType, setDamageType] = useState<DamageType>("slashing");
  return (
    <div className="character-editor">
      <div className="character-identity">
        <div className="portrait-shell">
          {character.portrait ? <img src={character.portrait} alt="" /> : <UserRound size={34} />}
          <label title="Upload portrait"><Upload size={12} /><input type="file" accept="image/*" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file || file.size > 3 * 1024 * 1024) return;
            const reader = new FileReader();
            reader.onload = () => updateCharacter(character.id, { portrait: String(reader.result) });
            reader.readAsDataURL(file);
          }} /></label>
        </div>
        <div className="identity-fields">
          <input className="character-name-input" value={character.name} onChange={(event) => updateCharacter(character.id, { name: event.target.value })} />
          <div><input value={character.ancestry} onChange={(event) => updateCharacter(character.id, { ancestry: event.target.value })} /><input value={character.className} onChange={(event) => updateCharacter(character.id, { className: event.target.value })} /><label>Lv <input type="number" min={1} max={20} value={character.level} onChange={(event) => { const level = Math.max(1, Math.min(20, Number(event.target.value))); updateCharacter(character.id, { level, proficiencyBonus: proficiencyBonusForLevel(level), hitDice: { die: character.hitDice?.die ?? 8, current: Math.min(character.hitDice?.current ?? level, level), maximum: level } }); }} /></label></div>
        </div>
        <button className="icon-button" title="Export character" onClick={() => exportCharacter(character)}><Download size={15} /></button>
      </div>

      <div className="vitals-row">
        <div className="vital-card hp-card"><Heart size={16} /><span>Hit points</span><strong>{character.hitPoints.current}<small> / {character.hitPoints.maximum}</small></strong></div>
        <div className="vital-card"><Shield size={16} /><span>Armor</span><strong>{character.armorClass}</strong></div>
        <div className="vital-card"><span className="speed-icon">➜</span><span>Speed</span><strong>{character.speed}<small> ft</small></strong></div>
      </div>
      <div className="sheet-access-row">
        <label>Miniature<select value={attachedTokenId} onChange={(event) => {
          if (attachedTokenId) linkTokenCharacter(attachedTokenId, null);
          if (event.target.value) linkTokenCharacter(event.target.value, character.id);
        }}><option value="">No custom miniature</option>{tokenAssets.map((token) => <option value={token.id} key={token.id}>{token.name} · {token.kind}</option>)}</select></label>
        <label>Sheet role<select value={character.role ?? "player"} onChange={(event) => updateCharacter(character.id, { role: event.target.value as NonNullable<Character["role"]> })}><option value="player">Player</option><option value="npc">NPC</option><option value="enemy">Enemy</option><option value="boss">Boss</option></select></label>
        <label>Visibility<select value={character.sheetVisibility ?? "players"} onChange={(event) => updateCharacter(character.id, { sheetVisibility: event.target.value as NonNullable<Character["sheetVisibility"]> })}><option value="players">Players and DM</option><option value="dm">DM only</option></select></label>
      </div>
      <div className="sheet-numeric-grid">
        <label>Player / owner<input value={character.playerName} onChange={(event) => updateCharacter(character.id, { playerName: event.target.value })} /></label>
        <label>Current HP<input type="number" min={0} value={character.hitPoints.current} onChange={(event) => updateCharacter(character.id, { hitPoints: { ...character.hitPoints, current: Math.max(0, Number(event.target.value)) } })} /></label>
        <label>Maximum HP<input type="number" min={1} value={character.hitPoints.maximum} onChange={(event) => updateCharacter(character.id, { hitPoints: { ...character.hitPoints, maximum: Math.max(1, Number(event.target.value)) } })} /></label>
        <label>Temporary HP<input type="number" min={0} value={character.hitPoints.temporary} onChange={(event) => updateCharacter(character.id, { hitPoints: { ...character.hitPoints, temporary: Math.max(0, Number(event.target.value)) } })} /></label>
        <label>Armor class<input type="number" min={0} value={character.armorClass} onChange={(event) => updateCharacter(character.id, { armorClass: Math.max(0, Number(event.target.value)) })} /></label>
        <label>Speed<input type="number" min={0} value={character.speed} onChange={(event) => updateCharacter(character.id, { speed: Math.max(0, Number(event.target.value)) })} /></label>
        <label>Proficiency<input type="number" min={0} value={character.proficiencyBonus} onChange={(event) => updateCharacter(character.id, { proficiencyBonus: Math.max(0, Number(event.target.value)) })} /></label>
      </div>
      <section className="sheet-utility-card" aria-labelledby={`damage-healing-${character.id}`}>
        <div className="section-label"><span id={`damage-healing-${character.id}`}>Damage and healing</span></div>
        <div className="hp-controls">
          <label><span>Amount</span><input aria-label="Hit point amount" type="number" min={1} value={hpAmount} onChange={(event) => setHpAmount(Math.max(1, Number(event.target.value)))} /></label>
          <label className="damage-type-field"><span>Damage type</span><select aria-label="Damage type" value={damageType} onChange={(event) => setDamageType(event.target.value as DamageType)}>{DAMAGE_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}</select></label>
          <button className="damage" onClick={() => damageCharacter(character.id, hpAmount, damageType)}><Minus size={13} /> Damage</button>
          <button className="heal" onClick={() => healCharacter(character.id, hpAmount)}><Heart size={13} /> Heal</button>
        </div>
      </section>

      <section className="sheet-utility-card recovery-card" aria-labelledby={`recovery-${character.id}`}>
        <div className="section-label"><span id={`recovery-${character.id}`}>Rest and recovery</span></div>
        <div className="rest-controls">
          <button title="Spend one Hit Point Die and recharge Short Rest resources" onClick={() => restCharacter(character.id, "short", 1)}><Sun size={13} /> Short rest</button>
          <button title="Restore HP, Hit Point Dice, and Long Rest resources" onClick={() => restCharacter(character.id, "long")}><Moon size={13} /> Long rest</button>
        </div>
        <div className="recovery-status">
          <div><span>Hit dice</span><strong>{character.hitDice?.current ?? 0} / {character.hitDice?.maximum ?? character.level} d{character.hitDice?.die ?? 8}</strong></div>
          <div><span>Death saves</span><strong><em className="save-success">{character.deathSaves?.successes ?? 0} saved</em><em className="save-failure">{character.deathSaves?.failures ?? 0} failed</em></strong></div>
          <div><span>Exhaustion</span><strong>{character.exhaustion ?? 0} / 6</strong></div>
        </div>
      </section>

      <div className="ability-grid">
        {(Object.keys(abilityLabels) as AbilityKey[]).map((ability) => (
          <label key={ability} className="ability-card">
            <span>{abilityLabels[ability]}</span>
            <strong>{formatModifier(abilityModifier(character.abilities[ability]))}</strong>
            <input type="number" min={1} max={30} value={character.abilities[ability]} onChange={(event) => updateCharacter(character.id, { abilities: { ...character.abilities, [ability]: Number(event.target.value) } })} />
          </label>
        ))}
      </div>

      <section className="sheet-section">
        <div className="section-label"><span>Conditions</span><small>SRD 5.2.1</small></div>
        <div className="condition-chips">
          {SRD_CONDITIONS.filter((condition) => condition !== "exhaustion").map((condition) => {
            const active = character.conditions.some((entry) => entry.toLowerCase() === condition);
            return <button key={condition} className={active ? "active" : ""} onClick={() => updateCharacter(character.id, { conditions: active ? character.conditions.filter((entry) => entry.toLowerCase() !== condition) : [...character.conditions, condition] })}>{condition}</button>;
          })}
        </div>
        <label className="exhaustion-control">Exhaustion level<input type="number" min={0} max={6} value={character.exhaustion ?? 0} onChange={(event) => updateCharacter(character.id, { exhaustion: Math.max(0, Math.min(6, Number(event.target.value))) })} /></label>
      </section>

      <section className="sheet-section">
        <div className="section-label"><span>Resources</span><button onClick={() => updateCharacter(character.id, { resources: [...character.resources, { id: crypto.randomUUID(), name: "New resource", current: 1, maximum: 1, recharge: "longRest" }] })}><Plus size={11} /> Add</button></div>
        <div className="resource-list">
          {character.resources.map((resource) => (
            <article className="resource-card" key={resource.id}>
              <header>
                <input aria-label="Resource name" value={resource.name} onChange={(event) => updateCharacter(character.id, { resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, name: event.target.value } : entry) })} />
                <output aria-label={`${resource.name} remaining`}>{resource.current} / {resource.maximum}</output>
                <button className="icon-button danger" aria-label={`Delete ${resource.name}`} onClick={() => updateCharacter(character.id, { resources: character.resources.filter((entry) => entry.id !== resource.id) })}><Trash2 size={12} /></button>
              </header>
              <div className="resource-card-body">
                <div className="resource-pips" role="group" aria-label={`${resource.name} slots`}>
                  {Array.from({ length: resource.maximum }, (_, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-label={`${resource.name} slot ${index + 1}`}
                      aria-pressed={index < resource.current}
                      className={index < resource.current ? "filled" : ""}
                      onClick={() => updateCharacter(character.id, { resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, current: index < resource.current ? index : index + 1 } : entry) })}
                    />
                  ))}
                  {resource.maximum === 0 && <small>No uses configured</small>}
                </div>
                <label className="resource-maximum"><span>Maximum</span><input aria-label={`${resource.name} maximum`} type="number" min={0} max={30} value={resource.maximum} onChange={(event) => updateCharacter(character.id, { resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, maximum: Math.max(0, Math.min(30, Number(event.target.value))), current: Math.min(entry.current, Math.max(0, Math.min(30, Number(event.target.value)))) } : entry) })} /></label>
                <label className="resource-recharge"><span>Recharges</span><select aria-label={`${resource.name} recharge`} value={resource.recharge} onChange={(event) => updateCharacter(character.id, { resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, recharge: event.target.value as typeof entry.recharge } : entry) })}><option value="none">Never</option><option value="shortRest">Short rest</option><option value="longRest">Long rest</option></select></label>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="sheet-section">
        <div className="section-label"><span>Actions</span><button onClick={() => updateCharacter(character.id, { actions: [...character.actions, { id: crypto.randomUUID(), name: "New action", description: "Describe this action." }] })}><Plus size={11} /> Add</button></div>
        {character.actions.map((action) => (
          <div className="action-row editable" key={action.id}><div><input value={action.name} onChange={(event) => updateCharacter(character.id, { actions: character.actions.map((entry) => entry.id === action.id ? { ...entry, name: event.target.value } : entry) })} /><textarea rows={2} value={action.description} onChange={(event) => updateCharacter(character.id, { actions: character.actions.map((entry) => entry.id === action.id ? { ...entry, description: event.target.value } : entry) })} /></div><label>Attack<input type="number" value={action.attackBonus ?? 0} onChange={(event) => updateCharacter(character.id, { actions: character.actions.map((entry) => entry.id === action.id ? { ...entry, attackBonus: Number(event.target.value) } : entry) })} /></label><label>Damage<input value={action.damage ?? ""} onChange={(event) => updateCharacter(character.id, { actions: character.actions.map((entry) => entry.id === action.id ? { ...entry, damage: event.target.value } : entry) })} /></label><button className="icon-button danger" aria-label={`Delete ${action.name}`} onClick={() => updateCharacter(character.id, { actions: character.actions.filter((entry) => entry.id !== action.id) })}><Trash2 size={11} /></button></div>
        ))}
      </section>

      <section className="sheet-section">
        <div className="section-label"><span>Inventory</span><button onClick={() => updateCharacter(character.id, { inventory: [...character.inventory, { id: crypto.randomUUID(), name: "New item", quantity: 1 }] })}><Plus size={11} /> Add</button></div>
        <div className="inventory-list editable">{character.inventory.map((item) => <div key={item.id}><input value={item.name} onChange={(event) => updateCharacter(character.id, { inventory: character.inventory.map((entry) => entry.id === item.id ? { ...entry, name: event.target.value } : entry) })} /><input aria-label={`${item.name} quantity`} type="number" min={0} value={item.quantity} onChange={(event) => updateCharacter(character.id, { inventory: character.inventory.map((entry) => entry.id === item.id ? { ...entry, quantity: Math.max(0, Number(event.target.value)) } : entry) })} /><label><input type="checkbox" checked={item.equipped ?? false} onChange={(event) => updateCharacter(character.id, { inventory: character.inventory.map((entry) => entry.id === item.id ? { ...entry, equipped: event.target.checked } : entry) })} /> Equipped</label><button className="icon-button danger" aria-label={`Delete ${item.name}`} onClick={() => updateCharacter(character.id, { inventory: character.inventory.filter((entry) => entry.id !== item.id) })}><Trash2 size={11} /></button></div>)}</div>
      </section>

      <label className="field-label">Character notes<textarea rows={4} value={character.notes} onChange={(event) => updateCharacter(character.id, { notes: event.target.value })} /></label>
    </div>
  );
}

export function CharacterPanel({ onNotify, showPrivate = true }: CharacterPanelProps) {
  const allCharacters = useCampaignStore((state) => state.campaign.characters);
  const characters = allCharacters.filter((character) => showPrivate || (character.sheetVisibility ?? "players") === "players");
  const activeCharacterId = useCampaignStore((state) => state.campaign.activeCharacterId);
  const setActiveCharacter = useCampaignStore((state) => state.setActiveCharacter);
  const addCharacter = useCampaignStore((state) => state.addCharacter);
  const removeCharacter = useCampaignStore((state) => state.removeCharacter);
  const [importResult, setImportResult] = useState<CharacterImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = characters.find((character) => character.id === activeCharacterId) ?? characters[0];

  const importFile = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    try {
      setImportResult(await importCharacterFile(file));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Character import failed", "error");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const acceptImport = () => {
    if (!importResult) return;
    addCharacter(importResult.character);
    onNotify(`${importResult.character.name} was added. Review any retained default fields before play.`, "success");
    setImportResult(null);
  };

  return (
    <div className="character-panel">
      <div className="character-toolbar">
        <select value={active?.id ?? ""} onChange={(event) => setActiveCharacter(event.target.value)}>
          {characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.className} {character.level}</option>)}
        </select>
        <button className="icon-button" title="Build a new character" onClick={() => setBuilderOpen(true)}><Plus size={16} /></button>
        <button className="icon-button" title="Import PDF or JSON" onClick={() => fileRef.current?.click()} disabled={importing}><Upload size={16} /></button>
        {active && <button className="icon-button danger" title="Delete character sheet" onClick={() => { if (window.confirm(`Delete ${active.name}'s sheet from this campaign?`)) { removeCharacter(active.id); onNotify(`${active.name}'s sheet was removed from this campaign.`, "warning"); } }}><Trash2 size={16} /></button>}
        <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf,.json" onChange={(event) => importFile(event.target.files?.[0])} />
      </div>
      {active ? <CharacterEditor character={active} /> : <div className="empty-panel"><UserRound size={28} /><h3>Create your first character</h3><button className="primary-button" onClick={() => setBuilderOpen(true)}><Plus size={14} /> Open character builder</button></div>}

      {builderOpen && <CharacterBuilder onCancel={() => setBuilderOpen(false)} onCreate={(character) => {
        addCharacter(character);
        setBuilderOpen(false);
        onNotify(`${character.name} joined the campaign with a complete SRD sheet.`, "success");
      }} />}

      {importResult && (
        <div className="modal-backdrop">
          <section className="import-review-modal" role="dialog" aria-modal="true">
            <button className="modal-close" onClick={() => setImportResult(null)}><X size={18} /></button>
            <span className="eyebrow"><Sparkles size={13} /> Import review</span>
            <h2>{importResult.character.name}</h2>
            <p>DnDRom extracted {importResult.fields.length} fields. Nothing becomes canonical until you accept this draft.</p>
            <div className="imported-fields">
              {importResult.fields.map((field) => <div key={field.field}><span>{field.field}</span><strong>{field.value}</strong><small>{Math.round(field.confidence * 100)}% · {field.source}</small></div>)}
            </div>
            {importResult.warnings.map((warning) => <p className="warning-callout" key={warning}>{warning}</p>)}
            <div className="modal-actions"><button onClick={() => setImportResult(null)}>Cancel</button><button className="primary-button" onClick={acceptImport}>Accept draft</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
