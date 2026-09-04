import { describe, expect, it } from "vitest";
import { EMERALD_ENERGY_EFFECTS, resolveDiceEffects } from "./diceEffects";
import { suggestDiceEffectsOffline } from "../ai/diceEffectDirector";

describe("dice effect themes", () => {
  it("keeps legacy themes off and clamps authored values to renderer budgets", () => {
    expect(resolveDiceEffects().surface.enabled).toBe(false);
    const resolved = resolveDiceEffects({
      ...EMERALD_ENERGY_EFFECTS,
      surface: { ...EMERALD_ENERGY_EFFECTS.surface, intensity: 99, speed: 0 },
      trail: { ...EMERALD_ENERGY_EFFECTS.trail, width: 4 },
      impact: { ...EMERALD_ENERGY_EFFECTS.impact, duration: 9 },
      particles: { ...EMERALD_ENERGY_EFFECTS.particles, count: 999, lifetime: 8, turbulence: 3 },
    });
    expect(resolved.surface.intensity).toBe(5);
    expect(resolved.surface.speed).toBe(.05);
    expect(resolved.trail.width).toBe(.24);
    expect(resolved.impact.duration).toBe(1.5);
    expect(resolved.particles).toMatchObject({ count: 96, lifetime: 2.5, turbulence: 1 });
  });

  it("turns material language into a complete offline-assisted VFX stack", () => {
    const storm = suggestDiceEffectsOffline("storm glass with lightning trapped in the cracks");
    expect(storm.surface).toMatchObject({ enabled: true, style: "lightning-cracks" });
    expect(storm.trail).toMatchObject({ enabled: true, style: "sparks" });
    expect(storm.impact).toMatchObject({ enabled: true, style: "shockwave" });
    expect(storm.particles).toMatchObject({ enabled: true, style: "sparks" });

    const inferno = suggestDiceEffectsOffline("molten lava and falling embers");
    expect(inferno.surface.style).toBe("lava");
    expect(inferno.trail.style).toBe("embers");
    expect(inferno.particles.style).toBe("embers");

    const romance = suggestDiceEffectsOffline("pink heart motes that burst into stars");
    expect(romance.particles).toMatchObject({ enabled: true, style: "stars", emission: "both" });
  });
});
