import { describe, expect, it } from "vitest";
import { concentrationDifficultyClass, longRest, movementCost, proficiencyBonusForLevel, resolveAttack, resolveDeathSave, resolveTypedDamage, rollDamage } from "./srdRules";
import { createDefaultCharacter } from "./seed";

const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe("SRD 5.2.1 mechanics", () => {
  it("uses the level-based proficiency progression", () => {
    expect([1, 5, 9, 13, 17].map(proficiencyBonusForLevel)).toEqual([2, 3, 4, 5, 6]);
  });

  it("honors natural attack results and cover", () => {
    expect(resolveAttack(0, 30, {}, sequence(0.999)).hit).toBe(true);
    expect(resolveAttack(20, 1, {}, sequence(0)).hit).toBe(false);
    expect(resolveAttack(5, 14, { cover: "half" }, sequence(0.5)).targetArmorClass).toBe(16);
    expect(resolveAttack(20, 1, { cover: "total" }, sequence(0.9)).hit).toBe(false);
  });

  it("doubles damage dice on a critical hit, not the modifier", () => {
    const damage = rollDamage("1d8+3", true, sequence(0, 0));
    expect(damage.rolls).toEqual([1, 1]);
    expect(damage.total).toBe(5);
  });

  it("applies adjustment, resistance, then vulnerability", () => {
    const damage = resolveTypedDamage(28, "fire", { flatAdjustment: -5, resistances: ["fire"], vulnerabilities: ["fire"] });
    expect(damage.finalDamage).toBe(22);
  });

  it("caps concentration DC and prices movement modes", () => {
    expect(concentrationDifficultyClass(100)).toBe(30);
    expect(concentrationDifficultyClass(21)).toBe(10);
    expect(movementCost(10, { difficultTerrain: true, climbing: true })).toBe(30);
  });

  it("handles natural 1 and 20 death saves", () => {
    const base = { successes: 0, failures: 0, stable: false, dead: false };
    expect(resolveDeathSave(base, sequence(0)).state.failures).toBe(2);
    expect(resolveDeathSave(base, sequence(0.999)).regainedHitPoint).toBe(true);
  });

  it("restores long-rest resources and reduces exhaustion", () => {
    const character = createDefaultCharacter();
    character.hitPoints.current = 1;
    character.exhaustion = 2;
    character.resources[0].current = 0;
    const rested = longRest(character);
    expect(rested.hitPoints.current).toBe(rested.hitPoints.maximum);
    expect(rested.exhaustion).toBe(1);
    expect(rested.resources[0].current).toBe(rested.resources[0].maximum);
  });
});
