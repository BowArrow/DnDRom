import { generateMapFromPrompt } from "./mapGenerator";
import type { Campaign, Character } from "./types";

export function createDefaultCharacter(): Character {
  const spellSlotsId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name: "Aria Thorn",
    playerName: "Player One",
    ancestry: "Human",
    className: "Ranger",
    level: 3,
    armorClass: 15,
    speed: 30,
    proficiencyBonus: 2,
    hitPoints: { current: 28, maximum: 28, temporary: 0 },
    abilities: {
      strength: 12,
      dexterity: 16,
      constitution: 14,
      intelligence: 10,
      wisdom: 15,
      charisma: 9,
    },
    proficientSkills: ["perception", "stealth", "survival", "athletics"],
    resources: [
      { id: spellSlotsId, name: "Spell Slots", current: 3, maximum: 3, recharge: "longRest" },
      { id: crypto.randomUUID(), name: "Second Wind", current: 1, maximum: 1, recharge: "shortRest" },
    ],
    actions: [
      {
        id: crypto.randomUUID(),
        name: "Longbow",
        description: "A precise ranged attack.",
        ability: "dexterity",
        attackBonus: 5,
        damage: "1d8+3",
        range: "150/600 ft",
      },
      {
        id: crypto.randomUUID(),
        name: "Hunter's Mark",
        description: "Mark a quarry for additional damage.",
        resourceId: spellSlotsId,
      },
    ],
    inventory: [
      { id: crypto.randomUUID(), name: "Longbow", quantity: 1, equipped: true },
      { id: crypto.randomUUID(), name: "Arrows", quantity: 20 },
      { id: crypto.randomUUID(), name: "Healing Potion", quantity: 1 },
      { id: crypto.randomUUID(), name: "Traveler's Pack", quantity: 1 },
    ],
    conditions: [],
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    hitDice: { die: 10, current: 3, maximum: 3 },
    savingThrowProficiencies: ["strength", "dexterity"],
    damageResistances: [],
    damageVulnerabilities: [],
    damageImmunities: [],
    tokenAssetId: "token-hero",
    notes: "Aria is searching for the cartographer who disappeared near the Ashen Vault.",
  };
}

export function createStarterCampaign(): Campaign {
  const now = new Date().toISOString();
  const character = createDefaultCharacter();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name: "The Ember Below",
    synopsis: "A missing cartographer, a sealed vault, and a fire that remembers every name spoken near it.",
    map: generateMapFromPrompt("A compact ancient dungeon with an inner treasure room and an orc guard"),
    characters: [character],
    activeCharacterId: character.id,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "dm",
        speaker: "Dungeon Master",
        content: "Rain needles the old road as the iron doors of the Ashen Vault emerge from the hillside. A warm draft carries the smell of cedar smoke from somewhere far below. What do you do?",
        createdAt: now,
      },
    ],
    storyThreads: [
      {
        id: crypto.randomUUID(),
        title: "Find the missing cartographer",
        status: "open",
        clock: 1,
        clockMax: 6,
        notes: "Mara Vey entered the vault three nights ago carrying a brass survey compass.",
      },
      {
        id: crypto.randomUUID(),
        title: "The fire learns your name",
        status: "open",
        clock: 0,
        clockMax: 4,
        notes: "Speaking a true name near the ember braziers advances this clock.",
      },
    ],
    events: [],
    revision: 0,
    settings: {
      ruleset: "srd-5.2.1",
      tone: "heroic",
      contentIntensity: "standard",
      lines: [],
      localAiEndpoint: "",
      localAiModel: "local-model",
      whisperEndpoint: "",
      speakDmResponses: true,
      useLocalAiForMaps: false,
      comfyUiEndpoint: "http://127.0.0.1:8188",
    },
    createdAt: now,
    updatedAt: now,
  };
}
