import * as pc from "playcanvas";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiceSides, DiceTheme } from "../domain/types";
import { resolvedMotionReduction } from "../domain/displaySettings";
import { resolveDiceEffects } from "../domain/diceEffects";
import type { DiceTextureFiles } from "../persistence/diceThemes";
import { createThemedDiceMaterial, loadDicePbrFilePreviews, loadDiceThemePbrTextures, updateThemedDiceMaterial } from "../rendering/diceThemeMaterial";
import { createDiceParticleEmitter } from "../rendering/diceParticleSystem";
import { dieGeometry, roundedDieMeshData } from "./SceneViewport";
import { useDisplaySettings } from "../state/useDisplaySettings";
import { claimSharedPlayCanvas, releaseSharedPlayCanvas } from "../rendering/sharedPlayCanvas";

interface DiceThemePreviewProps {
  theme: DiceTheme;
  files: DiceTextureFiles;
  sides: DiceSides;
  effectPreviewKey?: number;
}

export function DiceThemePreview({ theme, files, sides, effectPreviewKey = 0 }: DiceThemePreviewProps) {
  const displaySettings = useDisplaySettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const lastEffectPreviewKey = useRef(0);
  const themeRef = useRef(theme);
  const [status, setStatus] = useState("Preparing d20 preview…");

  themeRef.current = theme;

  const renderThemeKey = useMemo(() => JSON.stringify({
    id: theme.id,
    baseColor: theme.baseColor,
    roughness: theme.roughness,
    metallic: theme.metallic,
    clearCoat: theme.clearCoat,
    clearCoatGloss: theme.clearCoatGloss,
    normalStrength: theme.normalStrength,
    maps: theme.maps,
    effects: theme.effects,
  }), [theme.id, theme.baseColor, theme.roughness, theme.metallic, theme.clearCoat, theme.clearCoatGloss, theme.normalStrength, theme.maps, theme.effects]);

  useEffect(() => {
    setStatus((current) => current.includes("live PBR")
      ? `${theme.name || "Untitled theme"} · d${sides} live PBR + VFX preview`
      : current);
  }, [sides, theme.name]);

  useEffect(() => {
    const canvasHost = canvasHostRef.current;
    if (!canvasHost) return;
    const canvas = claimSharedPlayCanvas(canvasHost);
    canvasRef.current = canvas;
    canvas.dataset.sceneGeneration = String(Number(canvas.dataset.sceneGeneration ?? 0) + 1);
    let cancelled = false;
    const playOneShotDemo = effectPreviewKey > lastEffectPreviewKey.current;
    if (playOneShotDemo) lastEffectPreviewKey.current = effectPreviewKey;
    const antialiasing = displaySettings.antialiasing === "auto" ? "taa" : displaySettings.antialiasing;
    const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: antialiasing !== "off", alpha: true, powerPreference: "low-power" } });
    const resize = () => {
      const host = canvas.parentElement;
      app.resizeCanvas(Math.max(1, host?.clientWidth ?? 640), Math.max(1, host?.clientHeight ?? 480));
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
    };
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    const quality = displaySettings.quality === "scene" ? "balanced" : displaySettings.quality;
    const maximumPixelRatio = quality === "performance" ? 1 : quality === "balanced" ? 1.5 : 2;
    app.graphicsDevice.maxPixelRatio = Math.min((window.devicePixelRatio || 1) * displaySettings.resolutionScale, maximumPixelRatio * 1.15);
    app.scene.ambientLight = new pc.Color(.18, .2, .25);
    app.scene.exposure = 1.15;

    const camera = new pc.Entity("Dice Forge camera");
    camera.addComponent("camera", { clearColor: new pc.Color(.035, .03, .045, 1), fov: 39 });
    camera.setPosition(0, 1.15, 4.25);
    camera.lookAt(0, .25, 0);
    app.root.addChild(camera);
    const key = new pc.Entity("Warm key");
    const shadowQuality = displaySettings.shadowQuality === "auto" ? (quality === "diorama" ? "ultra" : quality === "performance" ? "low" : "high") : displaySettings.shadowQuality;
    key.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, .76, .54),
      intensity: 1.8,
      castShadows: shadowQuality !== "off",
      shadowDistance: 8,
      shadowResolution: shadowQuality === "ultra" ? 4096 : shadowQuality === "high" ? 2048 : 1024,
      shadowType: shadowQuality === "high" || shadowQuality === "ultra" ? pc.SHADOW_PCF5 : pc.SHADOW_PCF3,
      shadowBias: .18,
      normalOffsetBias: .08,
    });
    key.setEulerAngles(42, -38, 0);
    app.root.addChild(key);
    const fill = new pc.Entity("Cool fill");
    fill.addComponent("light", { type: "directional", color: new pc.Color(.44, .58, 1), intensity: .75 });
    fill.setEulerAngles(-28, 132, 0);
    app.root.addChild(fill);
    const rim = new pc.Entity("Arcane rim");
    rim.addComponent("light", { type: "directional", color: new pc.Color(.65, .42, 1), intensity: 1.1 });
    rim.setEulerAngles(18, 178, 0);
    app.root.addChild(rim);

    const groundMaterial = new pc.StandardMaterial();
    groundMaterial.diffuse = new pc.Color(.07, .055, .045);
    groundMaterial.metalness = .05;
    groundMaterial.gloss = .35;
    groundMaterial.update();
    const ground = new pc.Entity("Dice pedestal");
    ground.addComponent("render", { type: "cylinder" });
    ground.setLocalScale(3.3, .12, 3.3);
    ground.setLocalPosition(0, -.82, 0);
    if (ground.render) {
      ground.render.material = groundMaterial;
      // The pedestal only needs to receive the die's shadow. Keeping it out of
      // the caster pass removes the long self-shadow bands across its surface.
      ground.render.castShadows = false;
      ground.render.receiveShadows = true;
    }
    app.root.addChild(ground);

    const die = new pc.Entity(`Preview d${sides}`);
    const effects = resolveDiceEffects(theme.effects);
    const effectColor = (value: string) => {
      const parsed = Number.parseInt(value.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
      return new pc.Color(((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255);
    };
    const trailMaterial = new pc.StandardMaterial();
    trailMaterial.diffuse = effectColor(effects.trail.color);
    trailMaterial.emissive = effectColor(effects.trail.color);
    trailMaterial.emissiveIntensity = effects.trail.intensity * 2;
    trailMaterial.opacity = .72;
    trailMaterial.blendType = pc.BLEND_ADDITIVE;
    trailMaterial.depthWrite = false;
    trailMaterial.update();
    const impactMaterial = new pc.StandardMaterial();
    impactMaterial.diffuse = effectColor(effects.impact.color);
    impactMaterial.emissive = effectColor(effects.impact.color);
    impactMaterial.emissiveIntensity = effects.impact.intensity * 2.4;
    impactMaterial.opacity = .8;
    impactMaterial.blendType = pc.BLEND_ADDITIVE;
    impactMaterial.depthWrite = false;
    impactMaterial.update();
    const data = roundedDieMeshData(dieGeometry(sides));
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(data.positions);
    mesh.setNormals(data.normals);
    mesh.setUvs(0, data.uvs);
    mesh.setIndices(data.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    app.root.addChild(die);
    die.setLocalScale(1.55, 1.55, 1.55);
    die.setLocalEulerAngles(-16, 24, 8);
    const effectRoot = new pc.Entity("Dice effect preview");
    app.root.addChild(effectRoot);
    const trailParticles = playOneShotDemo ? createDiceParticleEmitter(app, effects.particles, "trail", `Preview ${effects.particles.style} particles`) : null;
    const impactParticles = playOneShotDemo ? createDiceParticleEmitter(app, effects.particles, "impact", `Preview ${effects.particles.style} impact burst`) : null;
    if (trailParticles) effectRoot.addChild(trailParticles.entity);
    if (impactParticles) { effectRoot.addChild(impactParticles.entity); impactParticles.entity.enabled = false; }
    const impactRing = new pc.Entity("Preview landing shockwave");
    impactRing.addComponent("render", { meshInstances: [new pc.MeshInstance(pc.createTorus(app.graphicsDevice, { tubeRadius: .035, ringRadius: .42, segments: 40, sides: 8 }), impactMaterial)], castShadows: false, receiveShadows: false });
    impactRing.setPosition(0, -.72, 0);
    impactRing.enabled = false;
    effectRoot.addChild(impactRing);
    const trail: Array<{ entity: pc.Entity; born: number }> = [];
    let diceMaterial: pc.StandardMaterial | null = null;
    let lastTrailAt = 0;
    let impactAt = -1;
    let impactTriggered = false;

    const load = async () => {
      const storedTextures = await loadDiceThemePbrTextures(app, theme);
      const unsavedTextures = Object.keys(files).length > 0 ? await loadDicePbrFilePreviews(app, files) : {};
      const textures = { ...storedTextures, ...unsavedTextures };
      if (cancelled) return;
      const material = createThemedDiceMaterial(theme, textures, app.graphicsDevice);
      diceMaterial = material;
      // Direct PBR lighting shades each convex face. The die still casts a real
      // contact shadow, but does not sample its own map and create acne stripes.
      die.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: true, receiveShadows: false });
      canvas.dataset.cleanShadowPolicy = "caster-only-die-pcf5";
      canvas.dataset.diceSelfShadow = "false";
      canvas.dataset.pedestalSelfShadow = "false";
      canvas.dataset.shadowResolution = shadowQuality === "ultra" ? "4096" : shadowQuality === "high" ? "2048" : shadowQuality === "off" ? "0" : "1024";
      canvas.dataset.antialiasing = antialiasing;
      canvas.dataset.diceEffects = `${effects.surface.enabled ? "surface" : ""},${effects.trail.enabled ? "trail" : ""},${effects.impact.enabled ? "impact" : ""}`;
      canvas.dataset.diceParticleSystem = effects.particles.enabled ? `gpu-bounded:${effects.particles.style}:${effects.particles.count}` : "off";
      canvas.dataset.effectDemoMode = playOneShotDemo ? "playing" : "idle";
      setStatus(`${theme.name || "Untitled theme"} · d${sides} live PBR + VFX preview`);
    };
    void load().catch((error) => setStatus(error instanceof Error ? error.message : "Dice preview failed"));
    const reducedMotion = resolvedMotionReduction(displaySettings);
    const demoStarted = performance.now();
    app.on("update", (delta: number) => {
      const now = performance.now();
      const seconds = now / 1000;
      if (diceMaterial) updateThemedDiceMaterial(diceMaterial, themeRef.current, seconds);
      if (reducedMotion) return;
      die.rotate(7 * delta, 17 * delta, 3 * delta);
      const demoAge = (now - demoStarted) / 1000;
      const flight = playOneShotDemo ? Math.min(1, demoAge / 1.15) : 1;
      const ease = 1 - Math.pow(1 - flight, 3);
      die.setPosition(playOneShotDemo ? 1.15 * (1 - ease) : 0, playOneShotDemo ? Math.sin(flight * Math.PI) * .42 : 0, playOneShotDemo ? .16 * Math.sin(flight * Math.PI * 2) : 0);
      if (trailParticles) trailParticles.entity.setPosition(die.getPosition());
      if (playOneShotDemo && effects.trail.enabled && demoAge < 1.15 && now - lastTrailAt > 48) {
        lastTrailAt = now;
        const mote = new pc.Entity(`Preview ${effects.trail.style} trail`);
        mote.addComponent("render", { type: effects.trail.style === "sparks" ? "box" : "sphere" });
        if (mote.render) { mote.render.material = trailMaterial; mote.render.castShadows = false; mote.render.receiveShadows = false; }
        const position = die.getPosition();
        mote.setPosition(position.x, position.y, position.z);
        mote.setLocalScale(effects.trail.width, effects.trail.width, effects.trail.width);
        effectRoot.addChild(mote);
        trail.push({ entity: mote, born: now });
      }
      for (let index = trail.length - 1; index >= 0; index--) {
        const mote = trail[index];
        const age = (now - mote.born) / 1000;
        if (age >= effects.trail.length) { mote.entity.destroy(); trail.splice(index, 1); continue; }
        const scale = effects.trail.width * (1 - age / effects.trail.length);
        mote.entity.setLocalScale(scale, scale, scale);
      }
      if (playOneShotDemo && demoAge >= 1.15 && !impactTriggered) {
        impactTriggered = true;
        impactAt = now;
        impactRing.enabled = effects.impact.enabled;
        trailParticles?.entity.particlesystem?.stop();
        if (impactParticles) {
          impactParticles.entity.setPosition(die.getPosition().x, -.7, die.getPosition().z);
          impactParticles.entity.enabled = true;
          impactParticles.entity.particlesystem?.reset();
          impactParticles.entity.particlesystem?.play();
        }
      }
      if (impactAt >= 0) {
        const progress = (now - impactAt) / (effects.impact.duration * 1000);
        if (progress >= 1) { impactRing.enabled = false; canvas.dataset.effectDemoMode = "complete"; }
        else {
          impactRing.enabled = true;
          const size = effects.impact.size * (.25 + progress * .75);
          impactRing.setLocalScale(size, size, size);
          impactMaterial.opacity = .8 * (1 - progress);
        }
      }
      if (playOneShotDemo && demoAge > 1.15 + Math.max(effects.trail.length, effects.impact.enabled ? effects.impact.duration : 0, impactParticles?.duration ?? 0) && canvas.dataset.effectDemoMode === "playing") canvas.dataset.effectDemoMode = "complete";
    });
    const resizeObserver = new ResizeObserver(resize);
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    resize();
    app.start();
    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      groundMaterial.destroy();
      trailMaterial.destroy();
      impactMaterial.destroy();
      app.destroy();
      releaseSharedPlayCanvas(canvasHost, canvas);
      canvasRef.current = null;
    };
  }, [displaySettings, effectPreviewKey, files, renderThemeKey, sides]);

  return <div className="dice-theme-preview"><div ref={canvasHostRef} className="shared-playcanvas-host" /><div className="dice-preview-number" style={{ color: theme.numberColor, WebkitTextStrokeColor: theme.numberOutlineColor }}>{sides === 100 ? "%" : sides}</div><span>{status}</span></div>;
}
