import { ASSET_CATALOG } from "./assets";
import type { GameMap, MaterialAsset, PropAsset, WorldAssetRequest, WorldPendingRefinement } from "./types";

const words = (value: string): Set<string> => new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2));
const score = (request: WorldAssetRequest, candidate: { name: string; description?: string }): number => {
  const wanted = words(`${request.name} ${request.description}`), offered = words(`${candidate.name} ${candidate.description ?? ""}`);
  let matches = 0;
  wanted.forEach((word) => { if (offered.has(word)) matches++; });
  return matches / Math.max(1, wanted.size);
};

const isMaterialRequest = (request: WorldAssetRequest): boolean => /material|surface|texture|ground|wall finish/i.test(`${request.name} ${request.description}`);

export interface RefinementResolutionInput {
  map: GameMap;
  campaignProps: PropAsset[];
  campaignMaterials: MaterialAsset[];
  deviceProps: PropAsset[];
  deviceMaterials: MaterialAsset[];
}

/** Catalogue order is authoritative: built-in, campaign, device, procedural, then reviewed AI. */
export function planWorldRefinements(input: RefinementResolutionInput): WorldPendingRefinement[] {
  const requests = input.map.generation?.blueprint.assetRequests ?? [];
  return requests.map((request) => {
    const material = isMaterialRequest(request);
    const campaign = material ? input.campaignMaterials : input.campaignProps;
    const device = material ? input.deviceMaterials : input.deviceProps;
    const campaignMatch = [...campaign].sort((a, b) => score(request, b) - score(request, a))[0];
    const deviceMatch = [...device].sort((a, b) => score(request, b) - score(request, a))[0];
    const builtIn = material ? undefined : ASSET_CATALOG.filter((asset) => asset.category === request.category).sort((a, b) => score(request, b) - score(request, a))[0];
    const matched = campaignMatch && score(request, campaignMatch) >= .18 ? { id: campaignMatch.id, source: "campaign" as const }
      : deviceMatch && score(request, deviceMatch) >= .18 ? { id: deviceMatch.id, source: "device" as const }
        : builtIn && score(request, builtIn) >= .22 ? { id: builtIn.id, source: "procedural" as const } : undefined;
    return {
      id: `refinement-${request.id}`,
      assetRequestId: request.id,
      kind: material ? "material" : "prop",
      prompt: request.description,
      status: matched ? "catalogue-match" : "needs-review",
      resolvedAssetId: matched?.id,
      source: matched?.source ?? "ai-request",
      createdAt: new Date().toISOString(),
    };
  });
}

export function approveWorldRefinement(refinements: WorldPendingRefinement[], id: string): WorldPendingRefinement[] {
  return refinements.map((refinement) => refinement.id === id && refinement.resolvedAssetId ? { ...refinement, status: "approved" } : refinement);
}

export function applyApprovedWorldRefinements(map: GameMap): GameMap {
  const refinements = map.pendingRefinements ?? [];
  const approved = new Map(refinements.filter((entry) => entry.status === "approved" && entry.resolvedAssetId).map((entry) => [entry.assetRequestId, entry]));
  if (!approved.size) return map;
  const entities = map.entities.map((entity) => {
    const requestTag = entity.tags?.find((tag) => tag.startsWith("asset-request:"));
    const refinement = requestTag ? approved.get(requestTag.slice("asset-request:".length)) : undefined;
    if (!refinement?.resolvedAssetId) return entity;
    return refinement.kind === "material" ? { ...entity, materialAssetId: refinement.resolvedAssetId } : { ...entity, assetId: refinement.resolvedAssetId };
  });
  return {
    ...map,
    entities,
    pendingRefinements: refinements.map((entry) => entry.status === "approved" ? { ...entry, status: "applied" } : entry),
    generation: map.generation ? { ...map.generation, revision: map.generation.revision + 1, generatedAt: new Date().toISOString() } : undefined,
  };
}

export function attachResolvedAsset(refinements: WorldPendingRefinement[], requestId: string, assetId: string, source: WorldPendingRefinement["source"]): WorldPendingRefinement[] {
  return refinements.map((entry) => entry.assetRequestId === requestId ? { ...entry, resolvedAssetId: assetId, source, status: "catalogue-match" } : entry);
}
