import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shaderSource = readFileSync(resolve(process.cwd(), "src/rendering/tabletopShaders.ts"), "utf8");
const cloudSource = readFileSync(resolve(process.cwd(), "src/rendering/volumetricClouds.ts"), "utf8");
const viewportSource = readFileSync(resolve(process.cwd(), "src/components/SceneViewport.tsx"), "utf8");

describe("procedural shader architecture contracts", () => {
  it("uses GPU-instanced grass with wind and player interaction uniforms", () => {
    expect(shaderSource).toContain("world-wind-grass-pbr");
    expect(shaderSource).toContain("uniform vec3 uPlayerPosition");
    expect(shaderSource).toContain("float rootLocked = smoothstep(.025, .28, localPos.y)");
    expect(shaderSource).toContain("float phase = fract(sin(dot(unbentWorld.xz");
    expect(shaderSource).toContain("localPos.x += playerBend.x");
    expect(viewportSource).toContain("meshInstance.setInstancing(instanceBuffer");
    expect(viewportSource).toContain("material.setParameter(\"uPlayerPosition\", grassTarget)");
    expect(viewportSource).toContain("castShadows: lod === 0, receiveShadows: true");
  });

  it("uses triplanar grass, dirt, rock, snow, and road layers with slope and height blending", () => {
    expect(shaderSource).toContain("vec3 dndromTriplanar");
    expect(shaderSource).toContain("uTerrainGrass");
    expect(shaderSource).toContain("uTerrainRock");
    expect(shaderSource).toContain("dot(normal, vec3(0.0, 1.0, 0.0))");
    expect(shaderSource).toContain("uWorldSurfaceWeather.z + 90.0");
    expect(shaderSource).not.toContain("smoothstep(5.0, 10.5, vPositionW.y)");
    expect(shaderSource).toContain("vVertexColor.a");
    expect(shaderSource).toContain("uTerrainNormalAtlas");
    expect(shaderSource).toContain("dndromAtlasNormal");
    expect(shaderSource).toContain("dndromTerrainNoise");
    expect(shaderSource).toContain("dGlossiness = grass * .035 + dirt * .018");
    expect(shaderSource).toContain('sand: make("sand"');
    expect(shaderSource).toContain('biomeId === "desert" ? layers.sand : layers.dirt');
    expect(shaderSource).toContain('biomeId === "desert" ? layers.sandNormal : layers.dirtNormal');
  });

  it("uses multi-wave Gerstner displacement, depth-buffer attenuation, reflection, and edge foam", () => {
    expect(shaderSource).toContain("steepA * amplitudeA * cos(phaseA)");
    expect(shaderSource).toContain("uniform sampler2D uSceneDepthMap");
    expect(shaderSource).toContain("uniform sampler2D uSceneColorMap");
    expect(shaderSource).toContain("uniform sampler2D uWaterNormal");
    expect(shaderSource).toContain("uniform samplerCube uWaterEnvironment");
    expect(shaderSource).toContain("vec3 normalB = texture2D(uWaterNormal");
    expect(shaderSource).toContain("vec3 absorption = exp(");
    expect(shaderSource).toContain("textureCube(uWaterEnvironment, reflect(-V, N))");
    expect(shaderSource).toContain("float shoreBand = smoothstep");
    expect(shaderSource).toContain("float foam = shoreBand");
    expect(shaderSource).toContain("color = mix(color, body");
    expect(viewportSource).toContain("requestSceneDepthMap(true)");
    expect(viewportSource).toContain("requestSceneColorMap(true)");
  });

  it("raymarches tiled Perlin-Worley volumes and applies Beer-law sun transmittance", () => {
    expect(cloudSource).toContain("volume: true");
    expect(cloudSource).toContain("uniform sampler3D uBaseNoise");
    expect(cloudSource).toContain("uniform sampler3D uDetailNoise");
    expect(cloudSource).toContain("for (int index = 0; index < 18; index++)");
    expect(cloudSource).toContain("float beer = exp(-sunOpticalDepth");
    expect(cloudSource).toContain("texture3D(uBaseNoise");
    expect(cloudSource).toContain("this.needsDepthBuffer = true");
    expect(viewportSource).toContain("if (coverage <= 0 || !legacyPostEffectAllowed)");
    expect(viewportSource).toContain("camera.postEffects.removeEffect(runtime.volumetricClouds)");
    expect(viewportSource).toContain("const legacyPostEffectAllowed = !runtime.lighting.cameraFrameRequested");
    expect(viewportSource).toContain("camera-frame-atmosphere");
    expect(viewportSource.indexOf("resizeToHost();")).toBeLessThan(viewportSource.indexOf("syncVolumetricClouds(runtime, callbacksRef.current.map)"));
  });
});
