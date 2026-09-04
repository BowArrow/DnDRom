import { abilityModifier } from "./rules";
import { proficiencyBonusForLevel } from "./srdRules";
import type { AbilityKey, AbilityScores, Character, CharacterAction, InventoryItem, ResourcePool } from "./types";

export type SrdEquipmentCategory = "armor" | "weapon" | "adventuring gear" | "tool" | "focus";

export interface SrdEquipment {
  id: string;
  name: string;
  category: SrdEquipmentCategory;
  description: string;
  damage?: string;
  damageType?: "bludgeoning" | "piercing" | "slashing";
  ranged?: boolean;
  finesse?: boolean;
  armorClass?: number;
  dexterityCap?: number;
  shieldBonus?: number;
}

export interface SrdClass {
  id: string;
  name: string;
  summary: string;
  primaryAbilities: AbilityKey[];
  hitDie: number;
  savingThrows: AbilityKey[];
  skillCount: number;
  skillOptions: string[];
  startingEquipment: string[];
  spellcasting: "none" | "full" | "half" | "pact";
}

export const SRD_CLASSES: SrdClass[] = [
  { id: "barbarian", name: "Barbarian", summary: "A durable warrior fueled by primal rage.", primaryAbilities: ["strength"], hitDie: 12, savingThrows: ["strength", "constitution"], skillCount: 2, skillOptions: ["animalHandling", "athletics", "intimidation", "nature", "perception", "survival"], startingEquipment: ["Greataxe", "Handaxe", "Explorer's Pack"], spellcasting: "none" },
  { id: "bard", name: "Bard", summary: "An inspiring expert who weaves magic through performance.", primaryAbilities: ["charisma"], hitDie: 8, savingThrows: ["dexterity", "charisma"], skillCount: 3, skillOptions: ["acrobatics", "animalHandling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleightOfHand", "stealth", "survival"], startingEquipment: ["Leather Armor", "Dagger", "Lute", "Entertainer's Pack"], spellcasting: "full" },
  { id: "cleric", name: "Cleric", summary: "A divine spellcaster trained for armor and support.", primaryAbilities: ["wisdom"], hitDie: 8, savingThrows: ["wisdom", "charisma"], skillCount: 2, skillOptions: ["history", "insight", "medicine", "persuasion", "religion"], startingEquipment: ["Chain Shirt", "Shield", "Mace", "Holy Symbol", "Priest's Pack"], spellcasting: "full" },
  { id: "druid", name: "Druid", summary: "A nature priest wielding primal magic and transformation.", primaryAbilities: ["wisdom"], hitDie: 8, savingThrows: ["intelligence", "wisdom"], skillCount: 2, skillOptions: ["animalHandling", "arcana", "insight", "medicine", "nature", "perception", "religion", "survival"], startingEquipment: ["Leather Armor", "Shield", "Sickle", "Druidic Focus", "Explorer's Pack"], spellcasting: "full" },
  { id: "fighter", name: "Fighter", summary: "A versatile martial specialist with excellent staying power.", primaryAbilities: ["strength", "dexterity"], hitDie: 10, savingThrows: ["strength", "constitution"], skillCount: 2, skillOptions: ["acrobatics", "animalHandling", "athletics", "history", "insight", "intimidation", "perception", "survival"], startingEquipment: ["Chain Mail", "Shield", "Longsword", "Light Crossbow", "Bolts", "Dungeoneer's Pack"], spellcasting: "none" },
  { id: "monk", name: "Monk", summary: "A mobile martial artist who fights with body and discipline.", primaryAbilities: ["dexterity", "wisdom"], hitDie: 8, savingThrows: ["strength", "dexterity"], skillCount: 2, skillOptions: ["acrobatics", "athletics", "history", "insight", "religion", "stealth"], startingEquipment: ["Spear", "Dagger", "Artisan's Tools", "Explorer's Pack"], spellcasting: "none" },
  { id: "paladin", name: "Paladin", summary: "An armored champion empowered by sacred oaths.", primaryAbilities: ["strength", "charisma"], hitDie: 10, savingThrows: ["wisdom", "charisma"], skillCount: 2, skillOptions: ["athletics", "insight", "intimidation", "medicine", "persuasion", "religion"], startingEquipment: ["Chain Mail", "Shield", "Longsword", "Javelin", "Holy Symbol", "Priest's Pack"], spellcasting: "half" },
  { id: "ranger", name: "Ranger", summary: "A wilderness warrior blending skill, weapons, and primal magic.", primaryAbilities: ["dexterity", "wisdom"], hitDie: 10, savingThrows: ["strength", "dexterity"], skillCount: 3, skillOptions: ["animalHandling", "athletics", "insight", "investigation", "nature", "perception", "stealth", "survival"], startingEquipment: ["Studded Leather Armor", "Scimitar", "Shortsword", "Longbow", "Arrows", "Druidic Focus", "Explorer's Pack"], spellcasting: "half" },
  { id: "rogue", name: "Rogue", summary: "A precise, resourceful expert in skills and opportunistic attacks.", primaryAbilities: ["dexterity"], hitDie: 8, savingThrows: ["dexterity", "intelligence"], skillCount: 4, skillOptions: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "performance", "persuasion", "sleightOfHand", "stealth"], startingEquipment: ["Leather Armor", "Dagger", "Shortsword", "Shortbow", "Arrows", "Thieves' Tools", "Burglar's Pack"], spellcasting: "none" },
  { id: "sorcerer", name: "Sorcerer", summary: "An innate arcane spellcaster whose magic comes from within.", primaryAbilities: ["charisma"], hitDie: 6, savingThrows: ["constitution", "charisma"], skillCount: 2, skillOptions: ["arcana", "deception", "insight", "intimidation", "persuasion", "religion"], startingEquipment: ["Spear", "Dagger", "Arcane Focus", "Dungeoneer's Pack"], spellcasting: "full" },
  { id: "warlock", name: "Warlock", summary: "An occult spellcaster empowered by an otherworldly pact.", primaryAbilities: ["charisma"], hitDie: 8, savingThrows: ["wisdom", "charisma"], skillCount: 2, skillOptions: ["arcana", "deception", "history", "intimidation", "investigation", "nature", "religion"], startingEquipment: ["Leather Armor", "Sickle", "Dagger", "Arcane Focus", "Scholar's Pack"], spellcasting: "pact" },
  { id: "wizard", name: "Wizard", summary: "A scholarly spellcaster with a broad and adaptable spellbook.", primaryAbilities: ["intelligence"], hitDie: 6, savingThrows: ["intelligence", "wisdom"], skillCount: 2, skillOptions: ["arcana", "history", "insight", "investigation", "medicine", "religion"], startingEquipment: ["Dagger", "Arcane Focus", "Spellbook", "Scholar's Pack"], spellcasting: "full" },
];

const weapon = (name: string, damage: string, damageType: SrdEquipment["damageType"], options: Partial<SrdEquipment> = {}): SrdEquipment => ({ id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"), name, category: "weapon", description: `${damage} ${damageType} damage.`, damage, damageType, ...options });
const gear = (name: string, category: SrdEquipmentCategory = "adventuring gear", description = "Useful adventuring equipment."): SrdEquipment => ({ id: name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"), name, category, description });

export const SRD_EQUIPMENT: SrdEquipment[] = [
  weapon("Club", "1d4", "bludgeoning"), weapon("Dagger", "1d4", "piercing", { finesse: true }), weapon("Greatclub", "1d8", "bludgeoning"),
  weapon("Handaxe", "1d6", "slashing"), weapon("Javelin", "1d6", "piercing"), weapon("Light Hammer", "1d4", "bludgeoning"),
  weapon("Mace", "1d6", "bludgeoning"), weapon("Quarterstaff", "1d6", "bludgeoning"), weapon("Sickle", "1d4", "slashing"), weapon("Spear", "1d6", "piercing"),
  weapon("Battleaxe", "1d8", "slashing"), weapon("Flail", "1d8", "bludgeoning"), weapon("Glaive", "1d10", "slashing"), weapon("Greataxe", "1d12", "slashing"),
  weapon("Greatsword", "2d6", "slashing"), weapon("Halberd", "1d10", "slashing"), weapon("Lance", "1d10", "piercing"), weapon("Longsword", "1d8", "slashing"),
  weapon("Maul", "2d6", "bludgeoning"), weapon("Morningstar", "1d8", "piercing"), weapon("Pike", "1d10", "piercing"), weapon("Rapier", "1d8", "piercing", { finesse: true }),
  weapon("Scimitar", "1d6", "slashing", { finesse: true }), weapon("Shortsword", "1d6", "piercing", { finesse: true }), weapon("Trident", "1d8", "piercing"), weapon("War Pick", "1d8", "piercing"),
  weapon("Warhammer", "1d8", "bludgeoning"), weapon("Whip", "1d4", "slashing", { finesse: true }), weapon("Dart", "1d4", "piercing", { finesse: true, ranged: true }),
  weapon("Light Crossbow", "1d8", "piercing", { ranged: true }), weapon("Shortbow", "1d6", "piercing", { ranged: true }), weapon("Longbow", "1d8", "piercing", { ranged: true }),
  weapon("Heavy Crossbow", "1d10", "piercing", { ranged: true }),
  { id: "padded-armor", name: "Padded Armor", category: "armor", description: "Light armor.", armorClass: 11 },
  { id: "leather-armor", name: "Leather Armor", category: "armor", description: "Light armor.", armorClass: 11 },
  { id: "studded-leather-armor", name: "Studded Leather Armor", category: "armor", description: "Light armor.", armorClass: 12 },
  { id: "hide-armor", name: "Hide Armor", category: "armor", description: "Medium armor.", armorClass: 12, dexterityCap: 2 },
  { id: "chain-shirt", name: "Chain Shirt", category: "armor", description: "Medium armor.", armorClass: 13, dexterityCap: 2 },
  { id: "scale-mail", name: "Scale Mail", category: "armor", description: "Medium armor.", armorClass: 14, dexterityCap: 2 },
  { id: "breastplate", name: "Breastplate", category: "armor", description: "Medium armor.", armorClass: 14, dexterityCap: 2 },
  { id: "half-plate-armor", name: "Half Plate Armor", category: "armor", description: "Medium armor.", armorClass: 15, dexterityCap: 2 },
  { id: "ring-mail", name: "Ring Mail", category: "armor", description: "Heavy armor.", armorClass: 14, dexterityCap: 0 },
  { id: "chain-mail", name: "Chain Mail", category: "armor", description: "Heavy armor.", armorClass: 16, dexterityCap: 0 },
  { id: "splint-armor", name: "Splint Armor", category: "armor", description: "Heavy armor.", armorClass: 17, dexterityCap: 0 },
  { id: "plate-armor", name: "Plate Armor", category: "armor", description: "Heavy armor.", armorClass: 18, dexterityCap: 0 },
  { id: "shield", name: "Shield", category: "armor", description: "+2 Armor Class while equipped.", shieldBonus: 2 },
  gear("Arrows"), gear("Bolts"), gear("Arcane Focus", "focus"), gear("Druidic Focus", "focus"), gear("Holy Symbol", "focus"), gear("Spellbook"),
  gear("Thieves' Tools", "tool"), gear("Artisan's Tools", "tool"), gear("Lute", "tool"), gear("Burglar's Pack"), gear("Dungeoneer's Pack"),
  gear("Entertainer's Pack"), gear("Explorer's Pack"), gear("Priest's Pack"), gear("Scholar's Pack"), gear("Healing Potion"), gear("Rope"), gear("Torch"), gear("Rations"), gear("Bedroll"), gear("Waterskin"),
];

export const SRD_SPECIES = ["Dragonborn", "Dwarf", "Elf", "Gnome", "Goliath", "Halfling", "Human", "Orc", "Tiefling"] as const;
export const SRD_BACKGROUNDS = [
  { name: "Acolyte", abilities: ["intelligence", "wisdom", "charisma"] as AbilityKey[], skills: ["insight", "religion"] },
  { name: "Criminal", abilities: ["dexterity", "constitution", "intelligence"] as AbilityKey[], skills: ["sleightOfHand", "stealth"] },
  { name: "Sage", abilities: ["constitution", "intelligence", "wisdom"] as AbilityKey[], skills: ["arcana", "history"] },
  { name: "Soldier", abilities: ["strength", "dexterity", "constitution"] as AbilityKey[], skills: ["athletics", "intimidation"] },
] as const;

export const DEFAULT_ABILITIES_BY_CLASS: Record<string, AbilityScores> = {
  barbarian: { strength: 15, dexterity: 13, constitution: 14, intelligence: 8, wisdom: 12, charisma: 10 },
  bard: { strength: 8, dexterity: 14, constitution: 13, intelligence: 10, wisdom: 12, charisma: 15 },
  cleric: { strength: 13, dexterity: 10, constitution: 14, intelligence: 8, wisdom: 15, charisma: 12 },
  druid: { strength: 8, dexterity: 13, constitution: 14, intelligence: 12, wisdom: 15, charisma: 10 },
  fighter: { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 },
  monk: { strength: 10, dexterity: 15, constitution: 13, intelligence: 8, wisdom: 14, charisma: 12 },
  paladin: { strength: 15, dexterity: 10, constitution: 13, intelligence: 8, wisdom: 12, charisma: 14 },
  ranger: { strength: 10, dexterity: 15, constitution: 13, intelligence: 8, wisdom: 14, charisma: 12 },
  rogue: { strength: 8, dexterity: 15, constitution: 13, intelligence: 14, wisdom: 12, charisma: 10 },
  sorcerer: { strength: 8, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 15 },
  warlock: { strength: 8, dexterity: 13, constitution: 14, intelligence: 12, wisdom: 10, charisma: 15 },
  wizard: { strength: 8, dexterity: 13, constitution: 14, intelligence: 15, wisdom: 12, charisma: 10 },
};

const FULL_CASTER_SLOTS: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const ordinal = (level: number): string => level === 1 ? "1st" : level === 2 ? "2nd" : level === 3 ? "3rd" : `${level}th`;

function classResources(classData: SrdClass, level: number): ResourcePool[] {
  const resources: ResourcePool[] = [];
  if (classData.id === "barbarian") resources.push({ id: crypto.randomUUID(), name: "Rage", current: level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2, maximum: level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2, recharge: "longRest" });
  if (classData.id === "bard") resources.push({ id: crypto.randomUUID(), name: "Bardic Inspiration", current: Math.max(1, abilityModifier(DEFAULT_ABILITIES_BY_CLASS.bard.charisma)), maximum: Math.max(1, abilityModifier(DEFAULT_ABILITIES_BY_CLASS.bard.charisma)), recharge: level >= 5 ? "shortRest" : "longRest" });
  if (classData.id === "fighter") resources.push({ id: crypto.randomUUID(), name: "Second Wind", current: level >= 4 ? 3 : 2, maximum: level >= 4 ? 3 : 2, recharge: "longRest" });
  if (classData.id === "paladin") resources.push({ id: crypto.randomUUID(), name: "Lay on Hands", current: level * 5, maximum: level * 5, recharge: "longRest" });
  if (classData.spellcasting === "pact") {
    const maximum = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1;
    const slotLevel = Math.min(5, Math.ceil(level / 2));
    resources.push({ id: crypto.randomUUID(), name: `Pact Magic · ${ordinal(slotLevel)} level`, current: maximum, maximum, recharge: "shortRest" });
  } else if (classData.spellcasting !== "none") {
    const casterLevel = classData.spellcasting === "half" ? Math.ceil(level / 2) : level;
    (FULL_CASTER_SLOTS[casterLevel - 1] ?? []).forEach((maximum, index) => resources.push({ id: crypto.randomUUID(), name: `${ordinal(index + 1)}-level Spell Slots`, current: maximum, maximum, recharge: "longRest" }));
  }
  return resources;
}

const itemQuantity = (name: string): number => name === "Arrows" || name === "Bolts" ? 20 : name === "Torch" ? 10 : 1;

export interface BuildCharacterOptions {
  name: string;
  playerName: string;
  classId: string;
  species: string;
  background: string;
  level: number;
  abilities: AbilityScores;
  skills: string[];
  equipmentNames: string[];
}

export function buildSrdCharacter(options: BuildCharacterOptions): Character {
  const classData = SRD_CLASSES.find((entry) => entry.id === options.classId) ?? SRD_CLASSES[0];
  const level = Math.max(1, Math.min(20, options.level));
  const proficiencyBonus = proficiencyBonusForLevel(level);
  const conModifier = abilityModifier(options.abilities.constitution);
  const maximumHitPoints = Math.max(1, classData.hitDie + conModifier + (level - 1) * (Math.floor(classData.hitDie / 2) + 1 + conModifier));
  const selectedEquipment = [...new Set(options.equipmentNames)].map((name) => SRD_EQUIPMENT.find((entry) => entry.name === name) ?? gear(name));
  const armor = selectedEquipment.find((item) => item.armorClass);
  const shieldBonus = selectedEquipment.reduce((total, item) => total + (item.shieldBonus ?? 0), 0);
  const dexterityModifier = abilityModifier(options.abilities.dexterity);
  const armorClass = (armor?.armorClass ?? 10) + Math.min(dexterityModifier, armor?.dexterityCap ?? dexterityModifier) + shieldBonus;
  const inventory: InventoryItem[] = selectedEquipment.map((item) => ({ id: crypto.randomUUID(), name: item.name, quantity: itemQuantity(item.name), equipped: item.category === "armor" || item.category === "weapon" }));
  const actions: CharacterAction[] = selectedEquipment.filter((item) => item.category === "weapon" && item.damage).map((item) => {
    const ability: AbilityKey = item.ranged || item.finesse ? "dexterity" : "strength";
    const modifier = abilityModifier(options.abilities[ability]);
    return { id: crypto.randomUUID(), name: item.name, description: item.description, ability, attackBonus: modifier + proficiencyBonus, damage: `${item.damage}${modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : modifier}`, range: item.ranged ? "Ranged" : "Melee" };
  });
  return {
    id: crypto.randomUUID(),
    name: options.name.trim() || "New Adventurer",
    playerName: options.playerName.trim(),
    ancestry: options.species,
    className: classData.name,
    level,
    armorClass,
    speed: 30,
    proficiencyBonus,
    hitPoints: { current: maximumHitPoints, maximum: maximumHitPoints, temporary: 0 },
    abilities: options.abilities,
    proficientSkills: [...new Set(options.skills)],
    resources: classResources(classData, level),
    actions,
    inventory,
    conditions: [],
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    hitDice: { die: classData.hitDie, current: level, maximum: level },
    savingThrowProficiencies: classData.savingThrows,
    damageResistances: [],
    damageVulnerabilities: [],
    damageImmunities: [],
    tokenAssetId: "",
    notes: `${options.background} background.`,
    importProvenance: "DnDRom SRD 5.2.1 guided builder",
    role: "player",
    sheetVisibility: "players",
  };
}
