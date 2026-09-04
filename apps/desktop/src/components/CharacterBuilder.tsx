import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, BookOpen, Check, Search, Shield, Sword, X } from "lucide-react";
import {
  buildSrdCharacter,
  DEFAULT_ABILITIES_BY_CLASS,
  SRD_BACKGROUNDS,
  SRD_CLASSES,
  SRD_EQUIPMENT,
  SRD_SPECIES,
} from "../domain/srdCharacterData";
import type { AbilityKey, AbilityScores, Character } from "../domain/types";

interface CharacterBuilderProps {
  onCancel: () => void;
  onCreate: (character: Character) => void;
}

const steps = ["Class", "Origin", "Abilities", "Skills", "Equipment", "Review"] as const;
const abilityLabels: Record<AbilityKey, string> = { strength: "Strength", dexterity: "Dexterity", constitution: "Constitution", intelligence: "Intelligence", wisdom: "Wisdom", charisma: "Charisma" };

export function CharacterBuilder({ onCancel, onCreate }: CharacterBuilderProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("New Adventurer");
  const [playerName, setPlayerName] = useState("");
  const [level, setLevel] = useState(1);
  const [classId, setClassId] = useState("fighter");
  const [species, setSpecies] = useState<(typeof SRD_SPECIES)[number]>("Human");
  const [background, setBackground] = useState<(typeof SRD_BACKGROUNDS)[number]["name"]>("Soldier");
  const [abilities, setAbilities] = useState<AbilityScores>({ ...DEFAULT_ABILITIES_BY_CLASS.fighter });
  const [skills, setSkills] = useState<string[]>(["athletics", "perception"]);
  const [equipmentNames, setEquipmentNames] = useState<string[]>([...SRD_CLASSES.find((entry) => entry.id === "fighter")!.startingEquipment]);
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const classData = SRD_CLASSES.find((entry) => entry.id === classId) ?? SRD_CLASSES[0];
  const backgroundData = SRD_BACKGROUNDS.find((entry) => entry.name === background) ?? SRD_BACKGROUNDS[0];
  const filteredEquipment = useMemo(() => {
    const query = equipmentSearch.trim().toLowerCase();
    return SRD_EQUIPMENT.filter((item) => !query || `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(query));
  }, [equipmentSearch]);

  const chooseClass = (nextClassId: string) => {
    const nextClass = SRD_CLASSES.find((entry) => entry.id === nextClassId) ?? SRD_CLASSES[0];
    setClassId(nextClass.id);
    setAbilities({ ...DEFAULT_ABILITIES_BY_CLASS[nextClass.id] });
    setSkills(nextClass.skillOptions.slice(0, nextClass.skillCount));
    setEquipmentNames([...nextClass.startingEquipment]);
  };

  const toggleSkill = (skill: string) => setSkills((current) => current.includes(skill)
    ? current.filter((entry) => entry !== skill)
    : current.length < classData.skillCount ? [...current, skill] : current);

  const toggleEquipment = (name: string) => setEquipmentNames((current) => current.includes(name)
    ? current.filter((entry) => entry !== name)
    : [...current, name]);

  const create = () => onCreate(buildSrdCharacter({
    name,
    playerName,
    classId,
    species,
    background,
    level,
    abilities,
    skills: [...new Set([...skills, ...backgroundData.skills])],
    equipmentNames,
  }));

  return createPortal(
    <div className="modal-backdrop character-builder-backdrop">
      <section className="character-builder-modal" role="dialog" aria-modal="true" aria-label="Guided character builder">
        <button className="modal-close" aria-label="Close character builder" onClick={onCancel}><X size={18} /></button>
        <header className="character-builder-heading">
          <span className="eyebrow"><BookOpen size={13} /> SRD 5.2.1 character builder</span>
          <h2>Build an adventurer</h2>
          <p>Choose from the bundled open rules, then keep editing the finished sheet inside this campaign.</p>
        </header>

        <div className="character-builder-layout">
          <nav className="builder-steps" aria-label="Character creation steps">
            {steps.map((label, index) => (
              <button key={label} className={index === step ? "active" : index < step ? "complete" : ""} onClick={() => setStep(index)}>
                <span>{index < step ? <Check size={12} /> : index + 1}</span><b>{label}</b>
              </button>
            ))}
            <a href="https://www.dndbeyond.com/srd" target="_blank" rel="noreferrer"><BookOpen size={13} /> Official SRD and license</a>
          </nav>

          <main className="builder-page">
            {step === 0 && <>
              <div className="builder-page-heading"><span>Step 1</span><h3>Choose a class</h3><p>Your class establishes Hit Dice, saving throws, skill choices, starting gear, and spell slots.</p></div>
              <div className="builder-identity-fields">
                <label>Character name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label>Player name<input value={playerName} placeholder="Optional" onChange={(event) => setPlayerName(event.target.value)} /></label>
                <label>Starting level<input type="number" min={1} max={20} value={level} onChange={(event) => setLevel(Math.max(1, Math.min(20, Number(event.target.value))))} /></label>
              </div>
              <div className="builder-class-grid">
                {SRD_CLASSES.map((entry) => <button key={entry.id} className={entry.id === classId ? "active" : ""} onClick={() => chooseClass(entry.id)}>
                  <span>{entry.name[0]}</span><div><b>{entry.name}</b><small>{entry.summary}</small><em>d{entry.hitDie} Hit Die &middot; {entry.primaryAbilities.map((ability) => abilityLabels[ability]).join(" / ")}</em></div>
                </button>)}
              </div>
            </>}

            {step === 1 && <>
              <div className="builder-page-heading"><span>Step 2</span><h3>Determine origin</h3><p>Select an SRD species and background. Background skill proficiencies are applied automatically.</p></div>
              <div className="builder-choice-section"><h4>Species</h4><div className="builder-option-grid species-options">{SRD_SPECIES.map((entry) => <button key={entry} className={entry === species ? "active" : ""} onClick={() => setSpecies(entry)}><b>{entry}</b><small>SRD species</small></button>)}</div></div>
              <div className="builder-choice-section"><h4>Background</h4><div className="builder-option-grid">{SRD_BACKGROUNDS.map((entry) => <button key={entry.name} className={entry.name === background ? "active" : ""} onClick={() => setBackground(entry.name)}><b>{entry.name}</b><small>{entry.skills.join(" · ")}</small><em>{entry.abilities.map((ability) => abilityLabels[ability]).join(", ")}</em></button>)}</div></div>
            </>}

            {step === 2 && <>
              <div className="builder-page-heading"><span>Step 3</span><h3>Set ability scores</h3><p>A class-weighted standard array is ready. Adjust any score if your table uses another generation method.</p></div>
              <div className="builder-ability-grid">
                {(Object.keys(abilityLabels) as AbilityKey[]).map((ability) => <label key={ability}><span>{abilityLabels[ability]}</span><input type="number" min={3} max={20} value={abilities[ability]} onChange={(event) => setAbilities((current) => ({ ...current, [ability]: Math.max(3, Math.min(20, Number(event.target.value))) }))} /><small>{classData.primaryAbilities.includes(ability) ? "Primary" : "Ability score"}</small></label>)}
              </div>
              <button className="builder-reset-button" onClick={() => setAbilities({ ...DEFAULT_ABILITIES_BY_CLASS[classId] })}>Restore class standard array</button>
            </>}

            {step === 3 && <>
              <div className="builder-page-heading"><span>Step 4</span><h3>Choose class skills</h3><p>Select {classData.skillCount}. Your {background} background also grants {backgroundData.skills.join(" and ")}.</p></div>
              <div className="builder-selection-count"><b>{skills.length}</b> / {classData.skillCount} class skills selected</div>
              <div className="builder-skill-grid">{classData.skillOptions.map((skill) => <label key={skill} className={skills.includes(skill) ? "active" : ""}><input type="checkbox" checked={skills.includes(skill)} onChange={() => toggleSkill(skill)} /><span>{skill.replace(/([A-Z])/g, " $1")}</span></label>)}</div>
            </>}

            {step === 4 && <>
              <div className="builder-page-heading"><span>Step 5</span><h3>Choose equipment</h3><p>The class package is preselected. Search the bundled SRD equipment catalog to customize it.</p></div>
              <label className="builder-equipment-search"><Search size={15} /><input aria-label="Search SRD equipment" value={equipmentSearch} placeholder="Search weapons, armor, gear…" onChange={(event) => setEquipmentSearch(event.target.value)} /></label>
              <div className="builder-equipment-summary">{equipmentNames.length} items selected <button onClick={() => setEquipmentNames([...classData.startingEquipment])}>Reset to {classData.name} package</button></div>
              <div className="builder-equipment-grid">{filteredEquipment.map((item) => <label key={item.id} className={equipmentNames.includes(item.name) ? "active" : ""}><input type="checkbox" checked={equipmentNames.includes(item.name)} onChange={() => toggleEquipment(item.name)} /><span>{item.category === "weapon" ? <Sword size={14} /> : <Shield size={14} />}</span><div><b>{item.name}</b><small>{item.category}{item.damage ? ` · ${item.damage} ${item.damageType}` : ""}</small></div></label>)}</div>
            </>}

            {step === 5 && <>
              <div className="builder-page-heading"><span>Step 6</span><h3>Review your adventurer</h3><p>DnDRom calculates HP, Armor Class, attacks, proficiency, Hit Dice, and resource tracks when you create the sheet.</p></div>
              <div className="builder-review-card">
                <div className="builder-review-portrait">{name.trim()[0]?.toUpperCase() || "?"}</div>
                <div><h4>{name.trim() || "New Adventurer"}</h4><p>Level {level} {species} {classData.name}</p><small>{background} &middot; d{classData.hitDie} Hit Die &middot; {classData.spellcasting === "none" ? "Martial" : `${classData.spellcasting} spellcasting`}</small></div>
              </div>
              <dl className="builder-review-list"><div><dt>Saving throws</dt><dd>{classData.savingThrows.map((ability) => abilityLabels[ability]).join(", ")}</dd></div><div><dt>Skills</dt><dd>{[...new Set([...skills, ...backgroundData.skills])].join(", ")}</dd></div><div><dt>Equipment</dt><dd>{equipmentNames.join(", ") || "None"}</dd></div><div><dt>Primary ability</dt><dd>{classData.primaryAbilities.map((ability) => `${abilityLabels[ability]} ${abilities[ability]}`).join(" / ")}</dd></div></dl>
              <p className="builder-license-note">Bundled content is limited to the openly licensed SRD 5.2.1. You can add homebrew and content you own after creation.</p>
            </>}
          </main>
        </div>

        <footer className="builder-footer">
          <button onClick={step === 0 ? onCancel : () => setStep((current) => current - 1)}>{step === 0 ? <X size={14} /> : <ArrowLeft size={14} />}{step === 0 ? "Cancel" : "Back"}</button>
          <span>Step {step + 1} of {steps.length}</span>
          {step < steps.length - 1
            ? <button className="primary-button" disabled={step === 0 && !name.trim() || step === 3 && skills.length !== classData.skillCount} onClick={() => setStep((current) => current + 1)}>Continue <ArrowRight size={14} /></button>
            : <button className="primary-button" onClick={create}><Check size={14} /> Create character</button>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
