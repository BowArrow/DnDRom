import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shaderSource = readFileSync(resolve(process.cwd(), "src/rendering/tabletopShaders.ts"), "utf8");
const cloudSource = readFileSync(resolve(process.cwd(), "src/rendering/volumetricClouds.ts"), "utf8");
const viewportSource = readFileSync(resolve(process.cwd(), "src/components/SceneViewport.tsx"), "utf8");

describe("procedural shader architecture contracts", () => {
  it("uses GPU-instanced grass with wind and player interaction uniforms", () => {
    expect(shaderSource).toContain("attribute vec4 instance_line1");
    expect(shaderSource).toContain("uniform vec3 uPlayerPosition");
    expect(shaderSource).toContain("world.xz += away * interaction * uBendStrength * weight");
    expect(viewportSource).toContain("meshInstance.setInstancing(instanceBuffer");
    expect(viewportSource).toContain("material.setParameter(\"uPlayerPosition\", grassTarget)");
  });

  it("uses triplanar grass, dirt, rock, snow, and road layers with slope and height blending", () => {
    expect(shaderSource).toContain("vec3 dndromTriplanar");
    expect(shaderSource).toContain("uTerrainGrass");
    expect(shaderSource).toContain("uTerrainRock");
    expect(shaderSource).toContain("dot(normal, vec3(0.0, 1.0, 0.0))");
    expect(shaderSource).toContain("smoothstep(5.0, 10.5, vPositionW.y)");
    expect(shaderSource).toContain("vVertexColor.a");
  });

  it("uses multi-wave Gerstner displacement, depth-buffer attenuation, refraction, reflection, and edge foam", () => {
    expect(shaderSource).toContain("steepA * amplitudeA * cos(phaseA)");
    expect(shaderSource).toContain("uniform sampler2D uSceneDepthMap");
    expect(shaderSource).toContain("uniform sampler2D uSceneColorMap");
    expect(shaderSource).toContain("uniform sampler2D uWaterNormal");
    expect(shaderSource).toContain("uniform samplerCube uWaterEnvironment");
    expect(shaderSource).toContain("vec3 normalB = texture2D(uWaterNormal");
    expect(shaderSource).toContain("vec3 absorption = exp(");
    expect(shaderSource).toContain("textureCube(uWaterEnvironment, reflect(-V, N))");
    expect(shaderSource).toContain("float foam = smoothstep");
    expect(viewportSource).toContain("requestSceneDepthMap(true)");
    expect(viewportSource).toContain("requestSceneColorMap(true)");
  });

  it("raymarches tiled Perlin-Worley volumes and applies Beer-law sun transmittance", () => {
    expect(cloudSource).toContain("volume: true");
    expect(cloudSource).toContain("uniform sampler3D uBaseNoise");
    expect(cloudSource).toContain("uniform sampler3D uDetailNoise");
    expect(cloudSource).toContain("for (int index = 0; index < 18; index++)");
    expect(cloudSource).toContain("float beer = exp(-sunOpticalDepth");
    expect(cloudSource).toContain("this.needsDepthBuffer = true");
    expect(viewportSource.indexOf("resizeToHost();")).toBeLessThan(viewportSource.indexOf("camera.camera.postEffects.addEffect(volumetricClouds)"));
  });
});
