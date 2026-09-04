import type { MaterialTarget } from "../domain/types";

const disallowed = /\b(?:child sexual|sexual minor|csam|terrorist propaganda|graphic torture|non-consensual sexual)\b/i;

export function validatePropPrompt(description: string): string {
  const clean = description.trim().replace(/\s+/g, " ").slice(0, 1200);
  if (!clean) throw new Error("Describe the prop or material first");
  if (disallowed.test(clean)) throw new Error("That prompt cannot be used for asset generation");
  return clean;
}

export function compileObjectPropPrompt(description: string): string {
  const clean = validatePropPrompt(description);
  return `${clean}. One isolated tabletop gaming prop, fully visible from base to top, centered three-quarter orthographic product view, neutral light gray background, shadow-free studio lighting, physically plausible proportions, painted premium board-game miniature finish, crisp silhouette, no floor plane, no scenery, no people, no text, no border, no cropped parts. Preserve a single coherent object suitable for image-to-3D reconstruction.`;
}

const materialContext: Record<MaterialTarget, string> = {
  floor: "seamless top-down orthographic material scan for a tabletop floor tile, planar XZ projection",
  wall: "seamless straight-on front elevation material scan for a modular tabletop wall, planar XY projection",
  pillar: "direction-neutral seamless material sample for triplanar projection on a tabletop pillar",
  general: "direction-neutral seamless tileable material sample for modular tabletop geometry",
};

export function compileMaterialPrompt(description: string, target: MaterialTarget): string {
  const clean = validatePropPrompt(description);
  return `${clean}. ${materialContext[target]}. Flat albedo only, even neutral illumination, edge-to-edge texture, physically plausible micro-detail, no objects, no perspective, no shadows, no highlights, no ambient occlusion baked into color, no border, no vignette, no text. Opposite edges must join perfectly.`;
}

export function promptAttribution(provider: "sana-local" | "krea-local" | "krea-cloud"): string {
  return provider === "sana-local" ? "Generated locally with Sana 1.5" : provider === "krea-local" ? "Generated locally with Krea 2" : "Generated with the separately billed Krea API";
}
