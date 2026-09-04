import { z } from "zod";
import { EMERALD_ENERGY_EFFECTS, resolveDiceEffects } from "../domain/diceEffects";
import type { CampaignSettings, DiceEffects } from "../domain/types";
import { completeLocalChat, extractJson } from "./openAiClient";

const effectSchema = z.object({
  surface: z.object({ enabled: z.boolean(), style: z.enum(["arcane-veins", "lightning-cracks", "lava", "frost", "runes"]), color: z.string().regex(/^#[0-9a-f]{6}$/i), intensity: z.number(), speed: z.number(), pulse: z.number() }),
  trail: z.object({ enabled: z.boolean(), style: z.enum(["wisps", "sparks", "embers"]), color: z.string().regex(/^#[0-9a-f]{6}$/i), intensity: z.number(), length: z.number(), width: z.number() }),
  impact: z.object({ enabled: z.boolean(), style: z.enum(["shockwave", "rune-burst", "shards"]), color: z.string().regex(/^#[0-9a-f]{6}$/i), intensity: z.number(), size: z.number(), duration: z.number() }),
  particles: z.object({ enabled: z.boolean(), style: z.enum(["soft-motes", "sparks", "embers", "snow", "smoke", "stars"]), emission: z.enum(["trail", "impact", "both"]), color: z.string().regex(/^#[0-9a-f]{6}$/i), secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i), count: z.number(), lifetime: z.number(), size: z.number(), speed: z.number(), gravity: z.number(), spread: z.number(), turbulence: z.number() }),
});

export function suggestDiceEffectsOffline(description: string): DiceEffects {
  const text = description.toLowerCase();
  const effects = structuredClone(EMERALD_ENERGY_EFFECTS);
  effects.particles.enabled = true;
  if (/lava|magma|fire|ember|inferno/.test(text)) {
    effects.surface.style = "lava"; effects.surface.color = "#ff6a1a"; effects.surface.intensity = 3;
    effects.trail.style = "embers"; effects.trail.color = "#ff8a2b";
    effects.impact.style = "shards"; effects.impact.color = "#ffb13b";
    effects.particles.style = "embers"; effects.particles.color = "#ff6a1a"; effects.particles.secondaryColor = "#ffd36a"; effects.particles.gravity = -.8;
  } else if (/ice|frost|winter|snow|crystal/.test(text)) {
    effects.surface.style = "frost"; effects.surface.color = "#8be8ff";
    effects.trail.style = "sparks"; effects.trail.color = "#b8f4ff";
    effects.impact.style = "shards"; effects.impact.color = "#a9eeff";
    effects.particles.style = "snow"; effects.particles.color = "#c7f5ff"; effects.particles.secondaryColor = "#ffffff"; effects.particles.gravity = -.35;
  } else if (/storm|lightning|thunder|electric/.test(text)) {
    effects.surface.style = "lightning-cracks"; effects.surface.color = "#9db8ff"; effects.surface.speed = 1.8;
    effects.trail.style = "sparks"; effects.trail.color = "#86a9ff";
    effects.impact.style = "shockwave"; effects.impact.color = "#b8c9ff";
    effects.particles.style = "sparks"; effects.particles.color = "#8fb4ff"; effects.particles.secondaryColor = "#ffffff"; effects.particles.speed = 1.5;
  } else if (/void|shadow|necrotic|amethyst|purple/.test(text)) {
    effects.surface.style = "runes"; effects.surface.color = "#bd72ff";
    effects.trail.color = "#8e52db"; effects.impact.color = "#c18aff";
    effects.particles.style = "smoke"; effects.particles.color = "#7137aa"; effects.particles.secondaryColor = "#d3a1ff"; effects.particles.gravity = .18;
  } else if (/gold|holy|solar|radiant/.test(text)) {
    effects.surface.style = "runes"; effects.surface.color = "#ffd86a";
    effects.trail.style = "sparks"; effects.trail.color = "#ffe59a"; effects.impact.color = "#fff0a8";
    effects.particles.style = "stars"; effects.particles.color = "#ffd86a"; effects.particles.secondaryColor = "#ffffff";
  } else if (/heart|rose|romance|love|pink/.test(text)) {
    effects.surface.style = "runes"; effects.surface.color = "#ff78bd";
    effects.trail.style = "wisps"; effects.trail.color = "#ff91ca";
    effects.impact.style = "rune-burst"; effects.impact.color = "#ffb1d8";
    effects.particles.style = "stars"; effects.particles.color = "#ff74b9"; effects.particles.secondaryColor = "#ffe0ef"; effects.particles.count = 48;
  }
  return resolveDiceEffects(effects);
}

export async function designDiceEffects(description: string, settings: CampaignSettings, signal?: AbortSignal, materialContext = ""): Promise<{ effects: DiceEffects; provider: "local-ai" | "offline-assist"; warning?: string }> {
  if (!settings.localAiEndpoint.trim()) return { effects: suggestDiceEffectsOffline(description), provider: "offline-assist" };
  try {
    const response = await completeLocalChat({
      endpoint: settings.localAiEndpoint,
      model: settings.localAiModel,
      signal,
      temperature: .45,
      maxTokens: 500,
      messages: [
        { role: "system", content: "You are a VFX art director for physical tabletop dice. Convert the user's requested effect into a tasteful, readable, GPU-bounded preset. Return JSON only with surface, trail, impact, and particles. Valid surface styles: arcane-veins, lightning-cracks, lava, frost, runes. Valid trail styles: wisps, sparks, embers. Valid impact styles: shockwave, rune-burst, shards. Valid particle styles: soft-motes, sparks, embers, snow, smoke, stars. Particle emission: trail, impact, or both. Colors must be six-digit hex. Limits: intensity 0-4, speed .05-3.5, pulse 0-1, trail length .15-1.5, width .025-.24, impact size .4-3, duration .2-1.5, particle count 4-96, lifetime .15-2.5, particle size .02-.28, gravity -3 to 3, spread .05-2, turbulence 0-1. Do not output shader code." },
        { role: "user", content: `Requested effect: ${description}\nDice material context: ${materialContext || "not provided"}` },
      ],
    });
    return { effects: resolveDiceEffects(effectSchema.parse(extractJson(response))), provider: "local-ai" };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { effects: suggestDiceEffectsOffline(description), provider: "offline-assist", warning: error instanceof Error ? error.message : "Local effect design failed" };
  }
}
