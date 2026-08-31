import type { AbilityKey, Character, DamageType } from "./types";

export type AdvantageState = "normal" | "advantage" | "disadvantage";
export type Cover = "none" | "half" | "three-quarters" | "total";
export type StandardAction = "attack" | "dash" | "disengage" | "dodge" | "help" | "hide" | "influence" | "magic" | "ready" | "search" | "study" | "utilize";
export type SrdCondition = "blinded" | "charmed" | "deafened" | "exhaustion" | "frightened" | "grappled" | "incapacitated" | "invisible" | "paralyzed" | "petrified" | "poisoned" | "prone" | "restrained" | "stunned" | "unconscious";

export const DAMAGE_TYPES: DamageType[] = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
export const STANDARD_ACTIONS: StandardAction[] = ["attack", "dash", "disengage", "dodge", "help", "hide", "influence", "magic", "ready", "search", "study", "utilize"];
export const SRD_CONDITIONS: SrdCondition[] = ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];

export const CONDITION_EFFECTS: Record<SrdCondition, { speedZero?: boolean; incapacitated?: boolean; attacksAgainst?: AdvantageState; attacksBy?: AdvantageState; autoFailStrengthDexterity?: boolean; criticalWithinFiveFeet?: boolean }> = {
  blinded: { attacksAgainst: "advantage", attacksBy: "disadvantage" },
  charmed: {},
  deafened: {},
  exhaustion: {},
  frightened: { attacksBy: "disadvantage" },
  grappled: { speedZero: true },
  incapacitated: { incapacitated: true },
  invisible: { attacksAgainst: "disadvantage", attacksBy: "advantage" },
  paralyzed: { speedZero: true, incapacitated: true, attacksAgainst: "advantage", autoFailStrengthDexterity: true, criticalWithinFiveFeet: true },
  petrified: { speedZero: true, incapacitated: true, attacksAgainst: "advantage", autoFailStrengthDexterity: true },
  poisoned: { attacksBy: "disadvantage" },
  prone: { attacksBy: "disadvantage" },
  restrained: { speedZero: true, attacksAgainst: "advantage", attacksBy: "disadvantage" },
  stunned: { incapacitated: true, attacksAgainst: "advantage", autoFailStrengthDexterity: true },
  unconscious: { speedZero: true, incapacitated: true, attacksAgainst: "advantage", autoFailStrengthDexterity: true, criticalWithinFiveFeet: true },
};

export interface D20Result {
  rolls: number[];
  kept: number;
  modifier: number;
  exhaustionPenalty: number;
  total: number;
  naturalOne: boolean;
  naturalTwenty: boolean;
}

export interface AttackResult extends D20Result {
  hit: boolean;
  critical: boolean;
  targetArmorClass: number;
  coverBonus: number;
  reason?: string;
}

export interface DamageProfile {
  resistances?: DamageType[];
  vulnerabilities?: DamageType[];
  immunities?: DamageType[];
  flatAdjustment?: number;
}

export interface DamageResolution {
  rolled: number;
  adjusted: number;
  afterResistance: number;
  finalDamage: number;
  immune: boolean;
  resisted: boolean;
  vulnerable: boolean;
}

export const proficiencyBonusForLevel = (levelOrCr: number): number => Math.max(2, Math.min(9, 2 + Math.floor((Math.max(1, levelOrCr) - 1) / 4)));
export const spellSaveDifficultyClass = (abilityModifier: number, proficiencyBonus: number): number => 8 + abilityModifier + proficiencyBonus;
export const passiveScore = (modifier: number, advantage: AdvantageState = "normal"): number => 10 + modifier + (advantage === "advantage" ? 5 : advantage === "disadvantage" ? -5 : 0);

const die = (sides: number, random: () => number): number => Math.floor(random() * sides) + 1;

export const combineAdvantage = (advantages: number, disadvantages: number): AdvantageState => {
  if (advantages > 0 && disadvantages > 0) return "normal";
  if (advantages > 0) return "advantage";
  if (disadvantages > 0) return "disadvantage";
  return "normal";
};

export function resolveD20Test(modifier: number, state: AdvantageState = "normal", exhaustionLevel = 0, random: () => number = Math.random): D20Result {
  const rolls = state === "normal" ? [die(20, random)] : [die(20, random), die(20, random)];
  const kept = state === "advantage" ? Math.max(...rolls) : state === "disadvantage" ? Math.min(...rolls) : rolls[0];
  const exhaustionPenalty = Math.max(0, Math.min(5, exhaustionLevel)) * 2;
  return { rolls, kept, modifier, exhaustionPenalty, total: kept + modifier - exhaustionPenalty, naturalOne: kept === 1, naturalTwenty: kept === 20 };
}

export function resolveAttack(attackModifier: number, targetArmorClass: number, options: { advantage?: AdvantageState; cover?: Cover; exhaustion?: number } = {}, random: () => number = Math.random): AttackResult {
  const coverBonus = options.cover === "half" ? 2 : options.cover === "three-quarters" ? 5 : 0;
  if (options.cover === "total") return { ...resolveD20Test(attackModifier, options.advantage, options.exhaustion, random), hit: false, critical: false, targetArmorClass, coverBonus: 0, reason: "Target has Total Cover" };
  const result = resolveD20Test(attackModifier, options.advantage, options.exhaustion, random);
  const effectiveArmorClass = targetArmorClass + coverBonus;
  const hit = result.naturalTwenty || (!result.naturalOne && result.total >= effectiveArmorClass);
  return { ...result, hit, critical: result.naturalTwenty, targetArmorClass: effectiveArmorClass, coverBonus };
}

export function rollDamage(expression: string, critical = false, random: () => number = Math.random): { rolls: number[]; modifier: number; total: number } {
  const match = expression.trim().toLowerCase().match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
  if (!match) throw new Error(`Invalid damage expression: ${expression}`);
  const baseCount = Number(match[1] || 1);
  const count = critical ? baseCount * 2 : baseCount;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) throw new Error("Damage expression is outside safe limits");
  const rolls = Array.from({ length: count }, () => die(sides, random));
  return { rolls, modifier, total: Math.max(0, rolls.reduce((sum, roll) => sum + roll, modifier)) };
}

export function resolveTypedDamage(amount: number, type: DamageType, profile: DamageProfile = {}): DamageResolution {
  const rolled = Math.max(0, Math.floor(amount));
  if (profile.immunities?.includes(type)) return { rolled, adjusted: rolled, afterResistance: 0, finalDamage: 0, immune: true, resisted: false, vulnerable: false };
  const adjusted = Math.max(0, rolled + Math.floor(profile.flatAdjustment ?? 0));
  const resisted = Boolean(profile.resistances?.includes(type));
  const vulnerable = Boolean(profile.vulnerabilities?.includes(type));
  const afterResistance = resisted ? Math.floor(adjusted / 2) : adjusted;
  return { rolled, adjusted, afterResistance, finalDamage: vulnerable ? afterResistance * 2 : afterResistance, immune: false, resisted, vulnerable };
}

export const concentrationDifficultyClass = (damageTaken: number): number => Math.min(30, Math.max(10, Math.floor(Math.max(0, damageTaken) / 2)));

export function movementCost(feet: number, options: { difficultTerrain?: boolean; climbing?: boolean; swimming?: boolean; crawling?: boolean; matchingSpeed?: boolean } = {}): number {
  let multiplier = options.difficultTerrain ? 2 : 1;
  if (!options.matchingSpeed && (options.climbing || options.swimming || options.crawling)) multiplier += 1;
  return Math.max(0, feet) * multiplier;
}

export function carryingCapacity(strength: number, size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan" = "medium"): { carry: number; pushDragLift: number } {
  const multiplier = size === "tiny" ? 7.5 : size === "large" ? 30 : size === "huge" ? 60 : size === "gargantuan" ? 120 : 15;
  return { carry: Math.max(0, strength) * multiplier, pushDragLift: Math.max(0, strength) * multiplier * 2 };
}

export function resolveDeathSave(current: NonNullable<Character["deathSaves"]>, random: () => number = Math.random): { state: NonNullable<Character["deathSaves"]>; roll: number; regainedHitPoint: boolean } {
  if (current.dead || current.stable) return { state: current, roll: 0, regainedHitPoint: false };
  const roll = die(20, random);
  if (roll === 20) return { state: { successes: 0, failures: 0, stable: false, dead: false }, roll, regainedHitPoint: true };
  const successes = current.successes + (roll >= 10 ? 1 : 0);
  const failures = current.failures + (roll === 1 ? 2 : roll < 10 ? 1 : 0);
  const stable = successes >= 3;
  return { state: { successes: stable ? 0 : successes, failures: stable ? 0 : failures, stable, dead: failures >= 3 }, roll, regainedHitPoint: false };
}

export function shortRest(character: Character, hitDiceToSpend = 0, random: () => number = Math.random): Character {
  const hitDice = character.hitDice ?? { die: 8, current: 0, maximum: Math.max(1, character.level) };
  const spend = Math.max(0, Math.min(hitDice.current, Math.floor(hitDiceToSpend)));
  let healing = 0;
  for (let index = 0; index < spend; index += 1) healing += Math.max(0, die(hitDice.die, random) + Math.floor((character.abilities.constitution - 10) / 2));
  return {
    ...character,
    hitPoints: { ...character.hitPoints, current: Math.min(character.hitPoints.maximum, character.hitPoints.current + healing) },
    hitDice: { ...hitDice, current: hitDice.current - spend },
    resources: character.resources.map((resource) => resource.recharge === "shortRest" ? { ...resource, current: resource.maximum } : resource),
  };
}

export function longRest(character: Character): Character {
  const hitDice = character.hitDice ?? { die: 8, current: Math.max(1, character.level), maximum: Math.max(1, character.level) };
  return {
    ...character,
    hitPoints: { ...character.hitPoints, current: character.hitPoints.maximum, temporary: 0 },
    hitDice: { ...hitDice, current: hitDice.maximum },
    exhaustion: Math.max(0, (character.exhaustion ?? 0) - 1),
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    resources: character.resources.map((resource) => resource.recharge !== "none" ? { ...resource, current: resource.maximum } : resource),
  };
}

export const RULES_COVERAGE = {
  ruleset: "SRD 5.2.1",
  implemented: ["D20 tests", "advantage and disadvantage", "proficiency progression", "skills and saving throws", "attack rolls", "critical hits", "cover", "typed damage", "resistance", "vulnerability", "immunity", "temporary hit points", "healing", "death saves", "concentration DC", "movement costs", "carrying capacity", "conditions metadata", "short rests", "long rests", "resource recharge"],
  dataDrivenNext: ["class feature automation", "full spell effect automation", "weapon mastery riders", "monster actions and recharge", "equipment pricing and crafting", "travel pace and hazards", "encounter budgets", "magic item effects"],
  excluded: ["non-SRD proprietary classes, monsters, spells, settings, and named characters"],
} as const;
