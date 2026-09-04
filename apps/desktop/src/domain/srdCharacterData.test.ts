import { describe, expect, it } from "vitest";
import { buildSrdCharacter, DEFAULT_ABILITIES_BY_CLASS, SRD_CLASSES, SRD_EQUIPMENT } from "./srdCharacterData";

describe("SRD guided character data", () => {
  it("bundles every SRD 5.2.1 base class and a usable equipment catalog", () => {
    expect(SRD_CLASSES.map((entry) => entry.name)).toEqual([
      "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
      "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard",
    ]);
    expect(SRD_EQUIPMENT.length).toBeGreaterThan(50);
    expect(new Set(SRD_EQUIPMENT.map((entry) => entry.id)).size).toBe(SRD_EQUIPMENT.length);
  });

  it("builds calculated attacks, armor, saves, hit dice, and level-specific spell slots", () => {
    const character = buildSrdCharacter({
      name: "Thalia",
      playerName: "Player",
      classId: "ranger",
      species: "Elf",
      background: "Soldier",
      level: 5,
      abilities: DEFAULT_ABILITIES_BY_CLASS.ranger,
      skills: ["perception", "stealth", "survival"],
      equipmentNames: ["Studded Leather Armor", "Longbow", "Arrows"],
    });

    expect(character.className).toBe("Ranger");
    expect(character.armorClass).toBe(14);
    expect(character.hitDice).toEqual({ die: 10, current: 5, maximum: 5 });
    expect(character.savingThrowProficiencies).toEqual(["strength", "dexterity"]);
    expect(character.actions[0]).toMatchObject({ name: "Longbow", ability: "dexterity", attackBonus: 5, damage: "1d8+2" });
    expect(character.resources.map((resource) => [resource.name, resource.maximum])).toEqual([
      ["1st-level Spell Slots", 4],
      ["2nd-level Spell Slots", 2],
    ]);
  });

  it("gives pact slots a short-rest recharge track", () => {
    const character = buildSrdCharacter({
      name: "Mara",
      playerName: "",
      classId: "warlock",
      species: "Human",
      background: "Sage",
      level: 5,
      abilities: DEFAULT_ABILITIES_BY_CLASS.warlock,
      skills: ["arcana", "investigation"],
      equipmentNames: ["Leather Armor", "Dagger", "Arcane Focus"],
    });
    expect(character.resources).toEqual([expect.objectContaining({ name: "Pact Magic · 3rd level", maximum: 2, recharge: "shortRest" })]);
  });
});
