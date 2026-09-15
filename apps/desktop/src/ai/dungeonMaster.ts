import { prepareLanguageSettings } from "./managedLanguage";
import { z } from "zod";
import { extractJson, streamLocalChat } from "./openAiClient";
import type { AbilityKey, Campaign, Character, DmResponse, RollRequest } from "../domain/types";

const abilities: AbilityKey[] = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

const dmResponseSchema = z.object({
  narration: z.string().min(1).max(1600),
  speaker: z.string().max(80).optional(),
  check: z.object({
    label: z.string().min(1).max(120),
    ability: z.enum(abilities),
    difficultyClass: z.number().int().min(5).max(30),
    proficient: z.boolean().optional(),
    advantage: z.enum(["normal", "advantage", "disadvantage"]).optional(),
  }).optional(),
  suggestedActions: z.array(z.string().min(1).max(140)).max(4).optional(),
  memory: z.string().max(280).optional(),
  sceneCue: z.enum(["danger", "mystery", "calm", "triumph"]).optional(),
  storyProgress: z.object({
    beatId: z.string(),
    outcome: z.enum(["activate", "success", "failure"]),
    reason: z.string().min(3).max(240),
  }).optional(),
});

const classifyOfflineCheck = (action: string): RollRequest | undefined => {
  const value = action.toLowerCase();
  const match = (pattern: RegExp, ability: AbilityKey, label: string, difficultyClass = 13): RollRequest | undefined =>
    pattern.test(value) ? { ability, label, difficultyClass, proficient: true, advantage: "normal" } : undefined;
  return (
    match(/sneak|hide|quiet|pickpocket|shadow/, "dexterity", "Stealth check", 13) ??
    match(/pick.*lock|disarm|balance|leap|dodge/, "dexterity", "Dexterity check", 14) ??
    match(/search|inspect|investigate|clue|mechanism/, "intelligence", "Investigation check", 12) ??
    match(/recall|history|arcane|rune|study|decipher/, "intelligence", "Knowledge check", 13) ??
    match(/listen|notice|watch|tracks|sense|perceive/, "wisdom", "Perception check", 12) ??
    match(/survive|navigate|forage|trail|track/, "wisdom", "Survival check", 12) ??
    match(/persuade|convince|negotiate|charm|reassure/, "charisma", "Persuasion check", 13) ??
    match(/lie|deceive|bluff|pretend/, "charisma", "Deception check", 14) ??
    match(/threaten|intimidate|scare/, "charisma", "Intimidation check", 13) ??
    match(/lift|break|force|climb|wrestle|shove/, "strength", "Athletics check", 13)
  );
};

const offlineNarration = (campaign: Campaign, character: Character, action: string, check?: RollRequest): DmResponse => {
  const value = action.toLowerCase();
  const location = campaign.map.name;
  if (/open|enter|door/.test(value)) {
    return {
      narration: `The hinges answer with a low iron groan. Beyond, ${location.toLowerCase()} exhales a current of warmer air, carrying ash and the faint scrape of something moving out of sight.`,
      suggestedActions: ["Listen at the threshold", "Enter with weapons ready", "Search the frame for a trap"],
      sceneCue: "mystery",
      check,
    };
  }
  if (/talk|ask|speak|greet|question/.test(value)) {
    return {
      speaker: "Wary stranger",
      narration: `The stranger studies ${character.name} for a long beat. “People come here looking for treasure,” they say. “The clever ones ask what the vault took in exchange.”`,
      suggestedActions: ["Ask about the missing cartographer", "Offer payment for a safe route", "Watch for signs of deception"],
      check,
      memory: `${character.name} initiated a conversation with a wary local.` ,
    };
  }
  if (/attack|shoot|strike|stab|cast/.test(value)) {
    return {
      narration: "Your hostile intent snaps the room into motion. The nearest foe shifts behind cover as loose grit skitters across the stone.",
      suggestedActions: ["Roll initiative", "Choose a target", "Try to de-escalate"],
      sceneCue: "danger",
    };
  }
  if (check) {
    return {
      narration: `You commit to the attempt. The surroundings offer no easy certainty; how this goes will depend on ${character.name}'s skill and the risks you are willing to accept.`,
      check,
      sceneCue: "mystery",
    };
  }
  return {
    narration: `The world responds to the choice rather than waiting for a script: ${action.trim().replace(/[.!?]+$/, "")}. In ${location}, a small detail changes—the distant scraping stops—and you have the uneasy sense that something has noticed.`,
    suggestedActions: ["Press the advantage", "Study what changed", "Regroup and make a plan"],
    sceneCue: "mystery",
  };
};

const summarizeCampaignForModel = (campaign: Campaign, character: Character): string => JSON.stringify({
  campaign: { name: campaign.name, synopsis: campaign.synopsis, tone: campaign.settings.tone },
  scene: {
    name: campaign.map.name,
    theme: campaign.map.theme,
    mapLevel: campaign.map.journey?.level,
    currentBuilding: campaign.map.journey?.interiors?.find(interior => interior.entityId === campaign.map.journey?.activeBuildingId),
    pointsOfInterest: campaign.map.pointsOfInterest,
    visibleEntities: campaign.map.entities.filter((entity) => !entity.hidden).slice(0, 80).map((entity) => ({ name: entity.name, asset: entity.assetId, position: entity.position, notes: entity.notes })),
  },
  character: {
    name: character.name,
    className: character.className,
    level: character.level,
    hitPoints: character.hitPoints,
    abilities: character.abilities,
    proficientSkills: character.proficientSkills,
    conditions: character.conditions,
    notes: character.notes,
  },
  openThreads: campaign.storyThreads.filter((thread) => thread.status === "open"),
  campaignArc: campaign.campaignPlan ? {
    premise: campaign.campaignPlan.premise,
    centralConflict: campaign.campaignPlan.centralConflict,
    antagonist: campaign.campaignPlan.antagonist,
    stakes: campaign.campaignPlan.stakes,
    finale: campaign.campaignPlan.finale,
    availableBeats: campaign.campaignPlan.beats.filter((beat) => ["available", "active"].includes(beat.status)).map((beat) => ({ id: beat.id, title: beat.title, summary: beat.summary, locationId: beat.locationId, status: beat.status, clues: beat.clues })),
    resolvedBeats: campaign.campaignPlan.beats.filter((beat) => ["resolved", "failed", "skipped"].includes(beat.status)).slice(-8).map((beat) => ({ title: beat.title, status: beat.status })),
  } : undefined,
  worldLocation: campaign.world?.locations.find((location) => location.id === campaign.activeLocationId),
  recentEvents: campaign.events.slice(-12).map((event) => event.summary),
  recentConversation: campaign.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
});

const partialNarration = (json: string): { text: string; complete: boolean } | null => {
  const match = /"narration"\s*:\s*"/.exec(json);
  if (!match) return null;
  const start = match.index + match[0].length;
  let escaped = false;
  let end = json.length;
  let complete = false;
  for (let index = start; index < json.length; index += 1) {
    const character = json[index];
    if (!escaped && character === '"') {
      end = index;
      complete = true;
      break;
    }
    if (!escaped && character === "\\") escaped = true;
    else escaped = false;
  }
  let raw = json.slice(start, end);
  if (escaped) raw = raw.slice(0, -1);
  try {
    return { text: JSON.parse(`"${raw}"`) as string, complete };
  } catch {
    return null;
  }
};

async function runLocalAi(
  campaign: Campaign,
  character: Character,
  action: string,
  signal?: AbortSignal,
  onNarrationChunk?: (chunk: string) => void,
): Promise<{ response: DmResponse; streamedNarration: boolean }> {
  let spokenLength = 0;
  let streamedNarration = false;
  const content = await streamLocalChat({
    endpoint: campaign.settings.localAiEndpoint,
    model: campaign.settings.localAiModel,
    signal,
    temperature: 0.72,
    maxTokens: 500,
    messages: [
      {
        role: "system",
        content: `You are DnDRom's concise AI Dungeon Master. Preserve player agency: never decide a player character's action, thoughts, or dialogue. Use only facts in the supplied state. Use the campaign arc as a flexible situation map, not a railroad; honor unexpected plans and fail forward. If an uncertain action needs a roll, propose exactly one check; code will roll it. Do not claim the result of a proposed check. Do not alter hit points, inventory, positions, or quest state. You may propose storyProgress only for a beat ID currently available/active; code validates and commits it. Keep narration under 120 words and end with room for the players to act. Return JSON only with: narration, optional speaker, optional check {label,ability,difficultyClass,proficient,advantage}, optional suggestedActions (maximum 4), optional memory, optional sceneCue, and optional storyProgress {beatId,outcome:activate|success|failure,reason}.`,
      },
      { role: "user", content: `CURRENT STATE:\n${summarizeCampaignForModel(campaign, character)}\n\nPLAYER ACTION:\n${action}` },
    ],
  }, (_delta, accumulated) => {
    if (!onNarrationChunk) return;
    const narration = partialNarration(accumulated);
    if (!narration || narration.text.length <= spokenLength) return;
    const remaining = narration.text.slice(spokenLength);
    const sentenceMatches = [...remaining.matchAll(/[.!?](?:\s|$)/g)];
    const lastBoundary = sentenceMatches.at(-1);
    const chunkLength = narration.complete ? remaining.length : lastBoundary ? (lastBoundary.index ?? 0) + lastBoundary[0].length : 0;
    if (chunkLength > 0) {
      const chunk = remaining.slice(0, chunkLength).trim();
      spokenLength += chunkLength;
      if (chunk) {
        streamedNarration = true;
        onNarrationChunk(chunk);
      }
    }
  });
  return { response: dmResponseSchema.parse(extractJson(content)), streamedNarration };
}

export async function runDungeonMaster(
  campaign: Campaign,
  action: string,
  signal?: AbortSignal,
  onNarrationChunk?: (chunk: string) => void,
): Promise<{ response: DmResponse; provider: "local-ai" | "offline"; warning?: string; streamedNarration?: boolean }> {
  const character = campaign.characters.find((entry) => entry.id === campaign.activeCharacterId) ?? campaign.characters[0];
  if (!character) throw new Error("Create a character before asking the Dungeon Master to resolve an action.");
  const check = classifyOfflineCheck(action);
  campaign = { ...campaign, settings: await prepareLanguageSettings(campaign.settings, signal) };
  if (campaign.settings.localAiEndpoint.trim()) {
    try {
      const result = await runLocalAi(campaign, character, action, signal, onNarrationChunk);
      return { ...result, provider: "local-ai" };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        response: offlineNarration(campaign, character, action, check),
        provider: "offline",
        warning: `Local AI was unavailable, so the deterministic offline director answered instead. ${error instanceof Error ? error.message : ""}`.trim(),
      };
    }
  }
  return { response: offlineNarration(campaign, character, action, check), provider: "offline" };
}

export function narrateRollOutcome(character: Character, request: RollRequest, total: number, success: boolean, naturalTwenty: boolean, naturalOne: boolean): string {
  if (naturalTwenty) return `${character.name}'s instinct and timing align perfectly. With a natural 20 (${total} total), the attempt succeeds in a way that creates a small additional advantage.`;
  if (naturalOne) return `${character.name}'s attempt goes badly awry. The natural 1 (${total} total) does not erase player agency, but it introduces a clear complication.`;
  return success
    ? `${character.name} succeeds on the ${request.label.toLowerCase()} with a ${total} against DC ${request.difficultyClass}. The intended approach works, and the situation moves in their favor.`
    : `${character.name} rolls ${total} against DC ${request.difficultyClass}. The attempt does not achieve its full intent; the world answers with a complication rather than a dead end.`;
}
