import { z } from "zod";
import type { CampaignPlan, CampaignSettings, LocationKind, MapTheme, PointOfInterest, StoryBeat, WorldLocation, WorldPlan } from "../domain/types";
import { completeLocalChat, extractJson } from "./openAiClient";

const rawBeatSchema = z.object({
  title: z.string().min(2).max(100),
  summary: z.string().min(10).max(500),
  locationName: z.string().min(2).max(80),
  locationKind: z.enum(["capital", "city", "town", "village", "wilderness", "dungeon", "landmark"]),
  biome: z.enum(["dungeon", "tavern", "forest", "ruins", "cavern", "city", "town", "village", "plains", "mountains", "coast", "swamp"]),
  encounterType: z.enum(["social", "exploration", "combat", "mystery", "downtime"]),
  successOutcome: z.string().min(5).max(300),
  failureOutcome: z.string().min(5).max(300),
  clues: z.array(z.string().min(2).max(160)).min(1).max(4),
});

const rawActSchema = z.object({
  title: z.string().min(2).max(100),
  purpose: z.string().min(10).max(400),
  levelStart: z.number().int().min(1).max(20),
  levelEnd: z.number().int().min(1).max(20),
  beats: z.array(rawBeatSchema).min(2).max(5),
});

const rawCampaignSchema = z.object({
  title: z.string().min(2).max(100),
  premise: z.string().min(20).max(600),
  incitingIncident: z.string().min(10).max(400),
  centralConflict: z.string().min(10).max(400),
  antagonist: z.string().min(2).max(120),
  antagonistGoal: z.string().min(10).max(400),
  stakes: z.string().min(10).max(400),
  finale: z.string().min(10).max(500),
  epilogue: z.string().min(10).max(400),
  acts: z.array(rawActSchema).min(3).max(5),
});

type RawCampaign = z.infer<typeof rawCampaignSchema>;

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seed: string): (() => number) => {
  let state = hashString(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const fallbackCampaign = (prompt: string): RawCampaign => ({
  title: "The Crown of Quiet Stars",
  premise: `${prompt.trim() || "A frontier realm is losing whole roads from memory"}. The heroes discover that places vanish first from maps, then from history, and finally from the world itself.`,
  incitingIncident: "A wounded courier reaches Briarwatch carrying a map whose ink is erasing itself in real time.",
  centralConflict: "An exiled royal cartographer is rewriting the realm around a buried celestial engine, believing a smaller world will be easier to save.",
  antagonist: "Master Surveyor Caldris Vale",
  antagonistGoal: "Activate the Meridian Engine and erase every region he cannot protect from the coming starfall.",
  stakes: "Settlements, relationships, and eventually the heroes themselves will be removed from history if the engine completes its final survey.",
  finale: "At the observatory beneath the capital, the party must confront Caldris while choosing whether to destroy, redirect, or claim the Meridian Engine.",
  epilogue: "The surviving roads and communities remember the party according to the choices they made, while the altered map reveals consequences and new frontiers.",
  acts: [
    {
      title: "Ink Going Pale",
      purpose: "Introduce the disappearing-road mystery, establish player bonds to the frontier, and reveal that the erasures follow an intentional survey.",
      levelStart: 1,
      levelEnd: 3,
      beats: [
        { title: "The Erasing Map", summary: "Protect the courier and examine the living map before its final route disappears.", locationName: "Briarwatch", locationKind: "town", biome: "town", encounterType: "mystery", successOutcome: "The party preserves a route and learns the surveyor's cipher.", failureOutcome: "The route vanishes, but refugees provide a dangerous alternate trail.", clues: ["Silver survey pins hum near erased ink", "The cipher marks three future targets"] },
        { title: "Road Without a Destination", summary: "Follow a broken trade road through terrain that no longer agrees with travelers' memories.", locationName: "The Pale March", locationKind: "wilderness", biome: "plains", encounterType: "exploration", successOutcome: "The party rescues a caravan and finds an intact meridian marker.", failureOutcome: "The caravan is scattered and the party reaches the marker exhausted.", clues: ["The marker points toward an abandoned hill observatory"] },
        { title: "The Surveyors' Wake", summary: "Confront agents collecting names and landmarks for the next erasure.", locationName: "Dunmere", locationKind: "village", biome: "village", encounterType: "social", successOutcome: "Villagers organize resistance and identify Caldris Vale.", failureOutcome: "The agents escape with the village register, advancing the threat.", clues: ["Caldris once served the royal observatory"] },
      ],
    },
    {
      title: "A Realm Redrawn",
      purpose: "Let the party choose alliances and routes while exposing the antagonist's motive and the cost of stopping him.",
      levelStart: 4,
      levelEnd: 7,
      beats: [
        { title: "Market of Borrowed Memories", summary: "Find a memory broker who can restore an erased path in exchange for a dangerous favor.", locationName: "Larkspire", locationKind: "city", biome: "city", encounterType: "social", successOutcome: "A path to the engine's relay is restored.", failureOutcome: "The path returns incomplete and passes through hostile territory.", clues: ["The erasures are powered from three relay sites"] },
        { title: "The Drowned Meridian", summary: "Disable a relay hidden below a flooded shrine without destroying the surrounding watershed.", locationName: "Mournwater Shrine", locationKind: "dungeon", biome: "cavern", encounterType: "exploration", successOutcome: "The western erasures stop and the party recovers an engine key.", failureOutcome: "The relay breaks violently, flooding nearby farms.", clues: ["Caldris expects a celestial impact within one year"] },
        { title: "Terms at Starfall Keep", summary: "Negotiate military access or infiltrate the fortress controlling the road to the capital.", locationName: "Starfall Keep", locationKind: "landmark", biome: "mountains", encounterType: "mystery", successOutcome: "The party gains passage and a committed ally.", failureOutcome: "They reach the capital as fugitives with the guard alerted.", clues: ["The crown funded the Meridian Engine before Caldris seized it"] },
      ],
    },
    {
      title: "The Final Survey",
      purpose: "Converge earlier alliances and consequences at the capital, then resolve the engine without prescribing the players' choice.",
      levelStart: 8,
      levelEnd: 10,
      beats: [
        { title: "City at the Edge of the Map", summary: "Enter the capital as districts begin disappearing and decide whom to save first.", locationName: "Asterfall", locationKind: "capital", biome: "city", encounterType: "exploration", successOutcome: "Saved factions open multiple routes to the observatory.", failureOutcome: "One route remains, controlled by Caldris's strongest defenders.", clues: ["The engine can be redirected, not only destroyed"] },
        { title: "The Meridian Engine", summary: "Reach the celestial mechanism and force Caldris to answer for the lives reduced to calculations.", locationName: "The Buried Observatory", locationKind: "dungeon", biome: "dungeon", encounterType: "combat", successOutcome: "The party controls the engine and chooses the realm's future.", failureOutcome: "The engine begins its final sequence, demanding a costly sacrifice or retreat.", clues: ["Every preserved survey pin can stabilize one threatened region"] },
        { title: "A Map With Room to Grow", summary: "Resolve the consequences in the communities the party preserved, changed, or lost.", locationName: "Briarwatch", locationKind: "town", biome: "town", encounterType: "downtime", successOutcome: "The campaign closes on a world shaped by player choices.", failureOutcome: "Even an imperfect victory leaves survivors able to rebuild.", clues: ["A blank edge on the new map hints at future adventures"] },
      ],
    },
  ],
});

const normalizePlan = (raw: RawCampaign): { plan: CampaignPlan; locationSpecs: Array<{ name: string; kind: LocationKind; biome: MapTheme; beatIds: string[] }> } => {
  const acts: CampaignPlan["acts"] = [];
  const beats: StoryBeat[] = [];
  const locationSpecs = new Map<string, { name: string; kind: LocationKind; biome: MapTheme; beatIds: string[] }>();
  let previousBeatId: string | undefined;
  for (const rawAct of raw.acts) {
    const actId = crypto.randomUUID();
    const beatIds: string[] = [];
    for (const rawBeat of rawAct.beats) {
      const id = crypto.randomUUID();
      beatIds.push(id);
      beats.push({
        id,
        actId,
        title: rawBeat.title,
        summary: rawBeat.summary,
        encounterType: rawBeat.encounterType,
        status: previousBeatId ? "locked" : "available",
        prerequisites: previousBeatId ? [previousBeatId] : [],
        successOutcome: rawBeat.successOutcome,
        failureOutcome: rawBeat.failureOutcome,
        clues: rawBeat.clues,
      });
      previousBeatId = id;
      const key = rawBeat.locationName.toLowerCase();
      const existing = locationSpecs.get(key);
      if (existing) existing.beatIds.push(id);
      else locationSpecs.set(key, { name: rawBeat.locationName, kind: rawBeat.locationKind, biome: rawBeat.biome, beatIds: [id] });
    }
    acts.push({ id: actId, title: rawAct.title, purpose: rawAct.purpose, levelStart: rawAct.levelStart, levelEnd: rawAct.levelEnd, beatIds });
  }
  return {
    plan: {
      id: crypto.randomUUID(),
      title: raw.title,
      premise: raw.premise,
      incitingIncident: raw.incitingIncident,
      centralConflict: raw.centralConflict,
      antagonist: raw.antagonist,
      antagonistGoal: raw.antagonistGoal,
      stakes: raw.stakes,
      finale: raw.finale,
      epilogue: raw.epilogue,
      acts,
      beats,
      createdAt: new Date().toISOString(),
    },
    locationSpecs: [...locationSpecs.values()],
  };
};

const buildWorld = (title: string, premise: string, seed: string, plan: CampaignPlan, specs: Array<{ name: string; kind: LocationKind; biome: MapTheme; beatIds: string[] }>): WorldPlan => {
  const random = seededRandom(seed);
  const locations: WorldLocation[] = specs.map((spec, index) => {
    const angle = (index / Math.max(1, specs.length)) * Math.PI * 2 + random() * 0.45;
    const radius = index === 0 ? 8 : 20 + random() * 28;
    const id = crypto.randomUUID();
    const pointOfInterests: PointOfInterest[] = spec.beatIds.map((beatId, beatIndex) => {
      const beat = plan.beats.find((entry) => entry.id === beatId)!;
      beat.locationId = id;
      return {
        id: crypto.randomUUID(),
        name: beat.title,
        kind: "story" as const,
        description: beat.summary,
        position: { x: (beatIndex - 1) * 5, y: 0, z: 2 + beatIndex * 4 },
        storyBeatIds: [beatId],
        discovered: beat.status !== "locked",
        tags: [beat.encounterType, spec.kind],
      };
    });
    pointOfInterests.push({ id: crypto.randomUUID(), name: `${spec.name} Waypoint`, kind: "landmark", description: `A recognizable local landmark in ${spec.name}.`, position: { x: -6, y: 0, z: -5 }, storyBeatIds: [], discovered: true, tags: [spec.biome] });
    return {
      id,
      name: spec.name,
      kind: spec.kind,
      biome: spec.biome,
      position: { x: Math.round(Math.cos(angle) * radius), z: Math.round(Math.sin(angle) * radius) },
      population: spec.kind === "capital" ? 42000 : spec.kind === "city" ? 15000 : spec.kind === "town" ? 2800 : spec.kind === "village" ? 420 : undefined,
      description: `${spec.name} is a ${spec.kind} tied to ${spec.beatIds.length} campaign beat${spec.beatIds.length === 1 ? "" : "s"}.`,
      storyBeatIds: spec.beatIds,
      pointOfInterests,
      mapSeed: `${seed}:${spec.name}:${spec.biome}`,
    };
  });
  const roads = locations.slice(1).map((location, index) => ({
    id: crypto.randomUUID(),
    fromLocationId: locations[index].id,
    toLocationId: location.id,
    name: `${locations[index].name}–${location.name} Road`,
    danger: Math.max(1, Math.min(5, Math.ceil(random() * 5))),
  }));
  return { id: crypto.randomUUID(), name: `${title} World`, seed, widthMiles: 120, depthMiles: 100, summary: premise, locations, roads };
};

export async function createStoryFirstCampaign(
  prompt: string,
  settings: CampaignSettings,
  signal?: AbortSignal,
): Promise<{ plan: CampaignPlan; world: WorldPlan; provider: "local-ai" | "procedural"; warning?: string }> {
  let raw: RawCampaign;
  let provider: "local-ai" | "procedural" = "procedural";
  let warning: string | undefined;
  if (settings.localAiEndpoint.trim()) {
    try {
      const content = await completeLocalChat({
        endpoint: settings.localAiEndpoint,
        model: settings.localAiModel,
        signal,
        temperature: 0.75,
        maxTokens: 3800,
        messages: [
          { role: "system", content: "Design an original, complete but non-railroaded fantasy campaign scaffold. Player choices must be able to change routes and outcomes. Create 3 acts with 2-5 beats each, a clear inciting incident, escalating central conflict, finale, and epilogue. Every beat needs a named location, settlement/location kind, biome, encounter pillar, success and fail-forward outcomes, and 1-4 discoverable clues. Do not use protected D&D settings or named characters. Return JSON only." },
          { role: "user", content: `CAMPAIGN REQUEST:\n${prompt}\n\nJSON SHAPE:\n{title,premise,incitingIncident,centralConflict,antagonist,antagonistGoal,stakes,finale,epilogue,acts:[{title,purpose,levelStart,levelEnd,beats:[{title,summary,locationName,locationKind,biome,encounterType,successOutcome,failureOutcome,clues:[]}]}]}` },
        ],
      });
      raw = rawCampaignSchema.parse(extractJson(content));
      provider = "local-ai";
    } catch (error) {
      if (signal?.aborted) throw error;
      raw = fallbackCampaign(prompt);
      warning = `Local story planning failed; the offline campaign director created a complete campaign instead. ${error instanceof Error ? error.message : ""}`.trim();
    }
  } else raw = fallbackCampaign(prompt);
  const normalized = normalizePlan(raw);
  const seed = `${raw.title}:${prompt}`;
  const world = buildWorld(raw.title, raw.premise, seed, normalized.plan, normalized.locationSpecs);
  return { plan: normalized.plan, world, provider, warning };
}
