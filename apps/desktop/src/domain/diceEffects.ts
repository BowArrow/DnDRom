import type { DiceEffects, DiceTheme } from "./types";

export const DEFAULT_DICE_EFFECTS: DiceEffects = {
  surface: { enabled: false, style: "arcane-veins", color: "#69ffe1", intensity: 1.8, speed: 1, pulse: .42 },
  trail: { enabled: false, style: "wisps", color: "#69ffe1", intensity: 1.2, length: .65, width: .09 },
  impact: { enabled: false, style: "shockwave", color: "#69ffe1", intensity: 1.5, size: 1.25, duration: .62 },
  particles: { enabled: false, style: "soft-motes", emission: "both", color: "#69ffe1", secondaryColor: "#d8fff7", count: 36, lifetime: .7, size: .09, speed: .8, gravity: -.25, spread: .55, turbulence: .35 },
};

export const EMERALD_ENERGY_EFFECTS: DiceEffects = {
  surface: { enabled: true, style: "arcane-veins", color: "#63ffd7", intensity: 2.35, speed: .85, pulse: .5 },
  trail: { enabled: true, style: "wisps", color: "#55e8c2", intensity: 1.15, length: .55, width: .075 },
  impact: { enabled: true, style: "rune-burst", color: "#79f8d2", intensity: 1.55, size: 1.25, duration: .65 },
  particles: { enabled: true, style: "soft-motes", emission: "both", color: "#55e8c2", secondaryColor: "#d8fff7", count: 42, lifetime: .72, size: .075, speed: .85, gravity: -.18, spread: .58, turbulence: .42 },
};

const finite = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
};

/** Normalizes old campaign data and clamps AI/user-authored values to renderer-safe budgets. */
export function resolveDiceEffects(effects?: Partial<DiceEffects>): DiceEffects {
  const surface = effects?.surface;
  const trail = effects?.trail;
  const impact = effects?.impact;
  const particles = effects?.particles;
  return {
    surface: {
      ...DEFAULT_DICE_EFFECTS.surface,
      ...surface,
      intensity: finite(surface?.intensity, DEFAULT_DICE_EFFECTS.surface.intensity, 0, 5),
      speed: finite(surface?.speed, DEFAULT_DICE_EFFECTS.surface.speed, .05, 4),
      pulse: finite(surface?.pulse, DEFAULT_DICE_EFFECTS.surface.pulse, 0, 1),
    },
    trail: {
      ...DEFAULT_DICE_EFFECTS.trail,
      ...trail,
      intensity: finite(trail?.intensity, DEFAULT_DICE_EFFECTS.trail.intensity, 0, 4),
      length: finite(trail?.length, DEFAULT_DICE_EFFECTS.trail.length, .15, 1.5),
      width: finite(trail?.width, DEFAULT_DICE_EFFECTS.trail.width, .025, .24),
    },
    impact: {
      ...DEFAULT_DICE_EFFECTS.impact,
      ...impact,
      intensity: finite(impact?.intensity, DEFAULT_DICE_EFFECTS.impact.intensity, 0, 4),
      size: finite(impact?.size, DEFAULT_DICE_EFFECTS.impact.size, .4, 3),
      duration: finite(impact?.duration, DEFAULT_DICE_EFFECTS.impact.duration, .2, 1.5),
    },
    particles: {
      ...DEFAULT_DICE_EFFECTS.particles,
      ...particles,
      count: Math.round(finite(particles?.count, DEFAULT_DICE_EFFECTS.particles.count, 4, 96)),
      lifetime: finite(particles?.lifetime, DEFAULT_DICE_EFFECTS.particles.lifetime, .15, 2.5),
      size: finite(particles?.size, DEFAULT_DICE_EFFECTS.particles.size, .02, .28),
      speed: finite(particles?.speed, DEFAULT_DICE_EFFECTS.particles.speed, .05, 3.5),
      gravity: finite(particles?.gravity, DEFAULT_DICE_EFFECTS.particles.gravity, -3, 3),
      spread: finite(particles?.spread, DEFAULT_DICE_EFFECTS.particles.spread, .05, 2),
      turbulence: finite(particles?.turbulence, DEFAULT_DICE_EFFECTS.particles.turbulence, 0, 1),
    },
  };
}

export function diceEffectSummary(theme: Pick<DiceTheme, "effects">): string {
  const effects = resolveDiceEffects(theme.effects);
  const active = [effects.surface.enabled && "energy", effects.trail.enabled && "trail", effects.impact.enabled && "impact", effects.particles.enabled && "particles"].filter(Boolean);
  return active.length ? active.join(" + ") : "effects off";
}
