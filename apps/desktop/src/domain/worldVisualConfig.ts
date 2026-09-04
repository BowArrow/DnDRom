/**
 * Runtime-tunable world rendering parameters.
 *
 * References:
 * - Perbet and Cani, "Animating Prairies in Real-Time" (I3D 2001)
 * - GPU Gems, Chapter 7, "Rendering Countless Blades of Waving Grass"
 * - Peytavie et al., "Procedural Riverscapes" (Computer Graphics Forum 2019)
 * - Galin et al., "Procedural Generation of Roads" (CGF 2010)
 *
 * These values are intentionally data rather than scattered literals so a
 * later debug panel can edit one typed object and trigger deterministic
 * regeneration.
 */
export interface WorldVisualConfig {
  roads: {
    cornerCutIterations: number;
    splineSamplesPerSpan: number;
    bridgeShoulderMeters: number;
    bridgeDedupeMeters: number;
  };
  grass: {
    clusterSpacingMeters: number;
    minimumMaskDensity: number;
    roadClearanceMeters: number;
    maximumSlope: number;
    minimumScale: number;
    scaleVariation: number;
  };
  forest: {
    minimumTreeRadius: number;
    maximumTreeRadius: number;
    densityMultiplier: number;
    cypressCrownScale: number;
  };
  water: {
    shallowColor: [number, number, number];
    deepColor: [number, number, number];
    shallowAlpha: number;
    deepAlpha: number;
    foamStrength: number;
  };
}

export const WORLD_VISUAL_CONFIG: Readonly<WorldVisualConfig> = {
  roads: {
    cornerCutIterations: 2,
    splineSamplesPerSpan: 5,
    bridgeShoulderMeters: 1.35,
    bridgeDedupeMeters: 4,
  },
  grass: {
    clusterSpacingMeters: .46,
    minimumMaskDensity: .82,
    roadClearanceMeters: .32,
    maximumSlope: .62,
    minimumScale: .82,
    scaleVariation: .42,
  },
  forest: {
    minimumTreeRadius: 2.15,
    maximumTreeRadius: 4.35,
    densityMultiplier: 1.58,
    cypressCrownScale: 1.32,
  },
  water: {
    shallowColor: [.018, .23, .25],
    deepColor: [.004, .055, .085],
    shallowAlpha: .48,
    deepAlpha: .82,
    foamStrength: .76,
  },
};
