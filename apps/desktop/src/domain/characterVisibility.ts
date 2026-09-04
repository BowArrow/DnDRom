import type { AppMode, Character, CampaignSettings } from "./types";

export function canViewCharacterSheet(character: Character, mode: AppMode, dungeonMasterMode: CampaignSettings["dungeonMasterMode"]): boolean {
  return mode === "build" || dungeonMasterMode === "player" || (character.sheetVisibility ?? "players") === "players";
}

export function visibleCharacterSheets(characters: Character[], mode: AppMode, dungeonMasterMode: CampaignSettings["dungeonMasterMode"]): Character[] {
  return characters.filter((character) => canViewCharacterSheet(character, mode, dungeonMasterMode));
}
