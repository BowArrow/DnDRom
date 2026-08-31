import type { AbilityKey, Character, RollRequest, RollResult } from "./types";

export const SKILL_ABILITIES: Record<string, AbilityKey> = {
  acrobatics: "dexterity",
  animalHandling: "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "intelligence",
  sleightOfHand: "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
};

export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);
export const formatModifier = (modifier: number): string => (modifier >= 0 ? `+${modifier}` : `${modifier}`);

const rollDie = (sides: number): number => Math.floor(Math.random() * sides) + 1;

export function rollDice(expression: string): { rolls: number[]; modifier: number; total: number } {
  const match = expression.trim().toLowerCase().match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
  if (!match) throw new Error(`Invalid dice expression: ${expression}`);
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) throw new Error("Dice expression is outside safe limits");
  const rolls = Array.from({ length: count }, () => rollDie(sides));
  return { rolls, modifier, total: rolls.reduce((sum, value) => sum + value, modifier) };
}

export function performCheck(character: Character, request: RollRequest): RollResult {
  const state = request.advantage ?? "normal";
  const rolls = state === "normal" ? [rollDie(20)] : [rollDie(20), rollDie(20)];
  const kept = state === "advantage" ? Math.max(...rolls) : state === "disadvantage" ? Math.min(...rolls) : rolls[0];
  const modifier = abilityModifier(character.abilities[request.ability]) + (request.proficient ? character.proficiencyBonus : 0);
  const total = kept + modifier - Math.max(0, Math.min(5, character.exhaustion ?? 0)) * 2;
  return {
    id: crypto.randomUUID(),
    label: request.label,
    rolls,
    kept,
    modifier,
    total,
    difficultyClass: request.difficultyClass,
    success: total >= request.difficultyClass,
    naturalOne: kept === 1,
    naturalTwenty: kept === 20,
  };
}

export function applyDamage(character: Character, amount: number): Character {
  let remaining = Math.max(0, Math.floor(amount));
  const absorbed = Math.min(character.hitPoints.temporary, remaining);
  remaining -= absorbed;
  const hitPointDamage = Math.max(0, remaining);
  const nextCurrent = Math.max(0, character.hitPoints.current - hitPointDamage);
  const excessDamage = Math.max(0, hitPointDamage - character.hitPoints.current);
  const wasAtZero = character.hitPoints.current === 0;
  const instantDeath = excessDamage >= character.hitPoints.maximum;
  const deathSaves = character.deathSaves ?? { successes: 0, failures: 0, stable: false, dead: false };
  const nextDeathSaves = instantDeath
    ? { ...deathSaves, dead: true, stable: false }
    : wasAtZero && hitPointDamage > 0
      ? { ...deathSaves, failures: Math.min(3, deathSaves.failures + 1), stable: false, dead: deathSaves.failures + 1 >= 3 }
      : nextCurrent === 0
        ? { successes: 0, failures: 0, stable: false, dead: false }
        : deathSaves;
  return {
    ...character,
    hitPoints: {
      ...character.hitPoints,
      temporary: character.hitPoints.temporary - absorbed,
      current: nextCurrent,
    },
    deathSaves: nextDeathSaves,
    conditions: nextCurrent === 0 && !nextDeathSaves.dead ? [...new Set([...character.conditions, "unconscious"])] : character.conditions,
  };
}

export function applyHealing(character: Character, amount: number): Character {
  return {
    ...character,
    hitPoints: {
      ...character.hitPoints,
      current: Math.min(character.hitPoints.maximum, character.hitPoints.current + Math.max(0, Math.floor(amount))),
    },
    deathSaves: amount > 0 ? { successes: 0, failures: 0, stable: false, dead: false } : character.deathSaves,
    conditions: amount > 0 ? character.conditions.filter((condition) => condition.toLowerCase() !== "unconscious") : character.conditions,
  };
}

export function armorClassFor(character: Character): number {
  return character.armorClass;
}
