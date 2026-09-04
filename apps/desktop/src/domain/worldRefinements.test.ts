import { describe, expect, it } from "vitest";
import { compileWorldBlueprint, createFallbackWorldBlueprints } from "./worldForge";
import { applyApprovedWorldRefinements, approveWorldRefinement, planWorldRefinements } from "./worldRefinements";
import type { MaterialAsset, PropAsset } from "./types";

const request = { description: "A swamp shrine with a unique regional landmark", kind: "auto" as const, size: "small" as const, gridShape: "square" as const, seed: 12, background: "none" as const };

describe("world refinement review", () => {
  it("prefers campaign catalogues and does not mutate geometry before approval and apply", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const compiled = compileWorldBlueprint(blueprint);
    const prop = { id: "prop-shrine", name: "Scenic landmark shrine", description: blueprint.assetRequests[0].description } as PropAsset;
    const material = { id: "material-regional", name: "Regional surface", description: blueprint.assetRequests[1].description } as MaterialAsset;
    const planned = planWorldRefinements({ map: compiled.map, campaignProps: [prop], campaignMaterials: [material], deviceProps: [], deviceMaterials: [] });
    expect(planned.every((entry) => entry.status === "catalogue-match")).toBe(true);
    const unchanged = { ...compiled.map, pendingRefinements: planned };
    expect(applyApprovedWorldRefinements(unchanged)).toBe(unchanged);
    const approved = planned.reduce((entries, entry) => approveWorldRefinement(entries, entry.id), planned);
    const applied = applyApprovedWorldRefinements({ ...compiled.map, pendingRefinements: approved });
    expect(applied.generation?.revision).toBe(2);
    expect(applied.entities.some((entry) => entry.assetId === prop.id)).toBe(true);
    expect(applied.entities.filter((entry) => entry.tags?.includes("world:terrain")).every((entry) => entry.materialAssetId === material.id)).toBe(true);
    expect(applied.pendingRefinements?.every((entry) => entry.status === "applied")).toBe(true);
  }, 15_000);

  it("leaves unmatched requests in mandatory human review", () => {
    const [blueprint] = createFallbackWorldBlueprints(request);
    const { map } = compileWorldBlueprint(blueprint);
    const planned = planWorldRefinements({ map, campaignProps: [], campaignMaterials: [], deviceProps: [], deviceMaterials: [] });
    expect(planned.some((entry) => entry.status === "needs-review")).toBe(true);
    expect(planned.filter((entry) => entry.source === "ai-request").every((entry) => !entry.resolvedAssetId)).toBe(true);
  });
});
