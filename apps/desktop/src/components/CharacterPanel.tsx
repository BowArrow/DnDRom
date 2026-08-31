import { useRef, useState } from "react";
import { Download, Heart, Moon, Plus, Shield, Sparkles, Sun, Upload, UserRound, X } from "lucide-react";
import { importCharacterFile, type CharacterImportResult } from "../importers/characterImport";
import { exportCharacter } from "../persistence/campaignFiles";
import { abilityModifier, formatModifier } from "../domain/rules";
import { DAMAGE_TYPES, proficiencyBonusForLevel, SRD_CONDITIONS } from "../domain/srdRules";
import type { AbilityKey, Character, DamageType } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";

interface CharacterPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

const abilityLabels: Record<AbilityKey, string> = {
  strength: "STR",
  dexterity: "DEX",
  constitution: "CON",
  intelligence: "INT",
  wisdom: "WIS",
  charisma: "CHA",
};

function CharacterEditor({ character }: { character: Character }) {
  const updateCharacter = useCampaignStore((state) => state.updateCharacter);
  const damageCharacter = useCampaignStore((state) => state.damageCharacter);
  const healCharacter = useCampaignStore((state) => state.healCharacter);
  const restCharacter = useCampaignStore((state) => state.restCharacter);
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
      <div className="hp-controls">
        <input type="number" min={1} value={hpAmount} onChange={(event) => setHpAmount(Math.max(1, Number(event.target.value)))} />
        <select aria-label="Damage type" value={damageType} onChange={(event) => setDamageType(event.target.value as DamageType)}>{DAMAGE_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}</select>
        <button className="damage" onClick={() => damageCharacter(character.id, hpAmount, damageType)}>Damage</button>
        <button className="heal" onClick={() => healCharacter(character.id, hpAmount)}>Heal</button>
        <button title="Spend one Hit Point Die and recharge Short Rest resources" onClick={() => restCharacter(character.id, "short", 1)}><Sun size={12} /> Short Rest</button>
        <button title="Restore HP, Hit Point Dice, and Long Rest resources" onClick={() => restCharacter(character.id, "long")}><Moon size={12} /> Long Rest</button>
      </div>

      <div className="rules-vitals">
        <span>Exhaustion <strong>{character.exhaustion ?? 0}/6</strong></span>
        <span>Hit Dice <strong>{character.hitDice?.current ?? 0}/{character.hitDice?.maximum ?? character.level}d{character.hitDice?.die ?? 8}</strong></span>
        <span>Death Saves <strong>{character.deathSaves?.successes ?? 0}✓ · {character.deathSaves?.failures ?? 0}✕</strong></span>
      </div>

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
        <div className="section-label"><span>Resources</span><small>Automatically tracked</small></div>
        {character.resources.map((resource) => (
          <div className="resource-row" key={resource.id}>
            <span>{resource.name}</span>
            <div className="resource-pips">
              {Array.from({ length: resource.maximum }, (_, index) => <button key={index} className={index < resource.current ? "filled" : ""} onClick={() => updateCharacter(character.id, { resources: character.resources.map((entry) => entry.id === resource.id ? { ...entry, current: index < resource.current ? index : index + 1 } : entry) })} />)}
            </div>
            <small>{resource.recharge.replace(/([A-Z])/g, " $1")}</small>
          </div>
        ))}
      </section>

      <section className="sheet-section">
        <div className="section-label"><span>Actions</span><small>{character.actions.length}</small></div>
        {character.actions.map((action) => (
          <div className="action-row" key={action.id}><div><strong>{action.name}</strong><p>{action.description}</p></div><span>{action.attackBonus !== undefined ? `${action.attackBonus >= 0 ? "+" : ""}${action.attackBonus}` : "—"}</span><small>{action.damage}</small></div>
        ))}
      </section>

      <section className="sheet-section">
        <div className="section-label"><span>Inventory</span><small>{character.inventory.reduce((sum, item) => sum + item.quantity, 0)} items</small></div>
        <div className="inventory-list">{character.inventory.map((item) => <div key={item.id}><span>{item.name}</span><small>×{item.quantity}</small>{item.equipped && <em>equipped</em>}</div>)}</div>
      </section>

      <label className="field-label">Character notes<textarea rows={4} value={character.notes} onChange={(event) => updateCharacter(character.id, { notes: event.target.value })} /></label>
    </div>
  );
}

export function CharacterPanel({ onNotify }: CharacterPanelProps) {
  const characters = useCampaignStore((state) => state.campaign.characters);
  const activeCharacterId = useCampaignStore((state) => state.campaign.activeCharacterId);
  const setActiveCharacter = useCampaignStore((state) => state.setActiveCharacter);
  const addCharacter = useCampaignStore((state) => state.addCharacter);
  const [importResult, setImportResult] = useState<CharacterImportResult | null>(null);
  const [importing, setImporting] = useState(false);
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
        <button className="icon-button" title="New character" onClick={() => addCharacter()}><Plus size={16} /></button>
        <button className="icon-button" title="Import PDF or JSON" onClick={() => fileRef.current?.click()} disabled={importing}><Upload size={16} /></button>
        <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf,.json" onChange={(event) => importFile(event.target.files?.[0])} />
      </div>
      {active ? <CharacterEditor character={active} /> : <div className="empty-panel"><UserRound size={28} /><h3>Create your first character</h3></div>}

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
