import { describe, expect, it } from "vitest";
import { abilityModifier, applyDamage, applyHealing, rollDice } from "./rules";
import { createDefaultCharacter } from "./seed";

describe("rules", () => {
  it("rounds ability modifiers down", () => {
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(9)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(18)).toBe(4);
  });

  it("applies temporary hit points first", () => {
    const character = createDefaultCharacter();
    character.hitPoints = { current: 12, maximum: 20, temporary: 4 };
    expect(applyDamage(character, 7).hitPoints).toEqual({ current: 9, maximum: 20, temporary: 0 });
  });

  it("caps healing at maximum", () => {
    const character = createDefaultCharacter();
    character.hitPoints = { current: 18, maximum: 20, temporary: 0 };
    expect(applyHealing(character, 10).hitPoints.current).toBe(20);
  });

  it("parses standard dice expressions", () => {
    const result = rollDice("2d6+3");
    expect(result.rolls).toHaveLength(2);
    expect(result.total).toBe(result.rolls[0] + result.rolls[1] + 3);
  });
});

