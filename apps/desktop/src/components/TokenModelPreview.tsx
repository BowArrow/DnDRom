import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pc from "playcanvas";
import { resolvedMotionReduction } from "../domain/displaySettings";
import { tokenBaseGeometry } from "../domain/tokenGeometry";
import type { BasePlateAsset, GameMap, MaterialAsset, PropAsset, SceneLightingSettings, TokenBaseShape, TokenKind } from "../domain/types";
import { applyLightingRig, applyLightweightAmbientToMaterial, createLightingRig, destroyLightingRig, rebuildEnvironment, type LightingRig } from "../rendering/lightingEngine";
import { applyMatteFloorFinish, applyMiniatureRimFinish, applySceneReactiveMiniatureFinish } from "../rendering/pbrAssetLibrary";
import { frameEntityInCamera, groundModelOnBase, modelBaseGap, tokenBaseTop } from "../rendering/modelGrounding";
import { useDisplaySettings } from "../state/useDisplaySettings";
import { renderBasePlate, type BasePlateRenderHandle } from "../rendering/basePlateRenderer";
import { claimSharedPlayCanvas, releaseSharedPlayCanvas } from "../rendering/sharedPlayCanvas";

interface TokenModelPreviewProps {
  model: File | null;
  kind: TokenKind;
  shape: TokenBaseShape;
  baseColor: string;
  accentColor: string;
  footprint: number;
  modelScale: number;
  placementScale: number;
  lighting?: Partial<SceneLightingSettings>;
  basePlate?: BasePlateAsset;
  cameraMode?: "isometric" | "top";
  propAssets?: PropAsset[];
  materialAssets?: MaterialAsset[];
}

interface PreviewRuntime {
  disposed: boolean;
  app: pc.Application;
  content: pc.Entity;
  materials: pc.Material[];
  asset: pc.Asset | null;
  pendingAsset: pc.Asset | null;
  objectUrl: string;
  pendingObjectUrl: string;
  reducedMotion: boolean;
  groundMaterial: pc.Material | null;
  lighting: LightingRig;
  miniature: pc.Entity | null;
  modelScale: number;
  baseTop: number;
  modelLoadCount: number;
  camera: pc.Entity;
  baseHost: pc.Entity;
  miniatureHost: pc.Entity;
  baseHandle: BasePlateRenderHandle | null;
  cameraMode: "isometric" | "top";
  lastTextInputAt: number;
}

const previewMap = (lighting?: Partial<SceneLightingSettings>): GameMap => ({
  id: "character-forge-preview",
  name: "Character Forge",
  theme: "tavern",
  width: 6,
  depth: 6,
  gridSize: 1,
  ambientColor: "#4f4a43",
  entities: [],
  lighting: { quality: "balanced", mood: "warm", iblIntensity: .7, keyIntensity: 1, fillIntensity: 1, rimIntensity: 1, exposure: 1, dynamicLights: false, ssao: true, bloom: true, depthOfField: false, fogMist: false, fogOfWar: false, ...lighting },
});

const color = (hex: string): pc.Color => {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized, 16);
  return new pc.Color(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

const material = (runtime: PreviewRuntime, hex: string, metalness = 0.05, gloss = 0.38): pc.StandardMaterial => {
  const result = new pc.StandardMaterial();
  result.diffuse = color(hex);
  result.emissive = color(hex);
  result.emissiveIntensity = 0.055;
  result.metalness = metalness;
  result.gloss = gloss;
  applyLightweightAmbientToMaterial(runtime.lighting, result);
  result.update();
  runtime.materials.push(result);
  return result;
};

const addPrimitive = (
  runtime: PreviewRuntime,
  parent: pc.Entity,
  name: string,
  type: "box" | "capsule" | "cone" | "cylinder" | "sphere",
  position: [number, number, number],
  scale: [number, number, number],
  hex: string,
): pc.Entity => {
  const entity = new pc.Entity(name);
  entity.addComponent("render", { type });
  entity.setLocalPosition(...position);
  entity.setLocalScale(...scale);
  if (entity.render) {
    entity.render.material = material(runtime, hex);
    entity.render.castShadows = true;
    entity.render.receiveShadows = true;
  }
  parent.addChild(entity);
  return entity;
};

const addBaseLayer = (
  runtime: PreviewRuntime,
  parent: pc.Entity,
  shape: TokenBaseShape,
  name: string,
  hex: string,
  y: number,
  diameter: number,
  height: number,
): void => {
  const geometry = tokenBaseGeometry(shape);
  const entity = new pc.Entity(name);
  const layerMaterial = material(runtime, hex, 0.16, 0.58);
  if (geometry.capSegments) {
    const mesh = pc.createCylinder(runtime.app.graphicsDevice, { height: 1, radius: 0.5, capSegments: geometry.capSegments });
    entity.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, layerMaterial)] });
  } else {
    entity.addComponent("render", { type: geometry.primitive });
    if (entity.render) entity.render.material = layerMaterial;
  }
  entity.setLocalPosition(0, y, 0);
  entity.setLocalScale(diameter, height, diameter);
  if (entity.render) {
    entity.render.castShadows = true;
    entity.render.receiveShadows = true;
  }
  parent.addChild(entity);
};

const addPlaceholderMiniature = (runtime: PreviewRuntime, parent: pc.Entity, kind: TokenKind, accentColor: string, baseTop: number, footprint: number): pc.Entity => {
  const figure = new pc.Entity("3D miniature placeholder");
  parent.addChild(figure);
  const bodyWidth = Math.min(0.52, footprint * 0.68);
  const stature = kind === "boss" ? 1.18 : 1;
  const skin = kind === "enemy" ? "#8ca06d" : "#d0c5b3";
  addPrimitive(runtime, figure, "left leg", "capsule", [-bodyWidth * 0.22, baseTop + 0.3 * stature, 0], [bodyWidth * 0.34, 0.56 * stature, bodyWidth * 0.34], "#303845");
  addPrimitive(runtime, figure, "right leg", "capsule", [bodyWidth * 0.22, baseTop + 0.3 * stature, 0], [bodyWidth * 0.34, 0.56 * stature, bodyWidth * 0.34], "#303845");
  addPrimitive(runtime, figure, "torso", "capsule", [0, baseTop + 0.82 * stature, 0], [bodyWidth, 0.72 * stature, bodyWidth * 0.72], accentColor);
  const leftArm = addPrimitive(runtime, figure, "left arm", "capsule", [-bodyWidth * 0.7, baseTop + 0.83 * stature, 0], [bodyWidth * 0.28, 0.65 * stature, bodyWidth * 0.28], accentColor);
  const rightArm = addPrimitive(runtime, figure, "right arm", "capsule", [bodyWidth * 0.7, baseTop + 0.83 * stature, 0], [bodyWidth * 0.28, 0.65 * stature, bodyWidth * 0.28], accentColor);
  leftArm.setLocalEulerAngles(0, 0, -14);
  rightArm.setLocalEulerAngles(0, 0, 14);
  addPrimitive(runtime, figure, "head", "sphere", [0, baseTop + 1.34 * stature, 0], [bodyWidth * 0.68, bodyWidth * 0.68, bodyWidth * 0.68], skin);
  if (kind === "boss") {
    const leftHorn = addPrimitive(runtime, figure, "left horn", "cone", [-bodyWidth * 0.48, baseTop + 1.7 * stature, 0], [0.14, 0.38, 0.14], "#d5b55b");
    const rightHorn = addPrimitive(runtime, figure, "right horn", "cone", [bodyWidth * 0.48, baseTop + 1.7 * stature, 0], [0.14, 0.38, 0.14], "#d5b55b");
    leftHorn.setLocalEulerAngles(0, 0, -22);
    rightHorn.setLocalEulerAngles(0, 0, 22);
  }
  return figure;
};

export function TokenModelPreview({ model, kind, shape, baseColor, accentColor, footprint, modelScale, placementScale, lighting, basePlate, cameraMode = "isometric", propAssets, materialAssets }: TokenModelPreviewProps) {
  const displaySettings = useDisplaySettings();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const [modelIssue, setModelIssue] = useState("");

  useLayoutEffect(() => {
    const canvasHost = canvasHostRef.current;
    if (!canvasHost) return;
    const canvas = claimSharedPlayCanvas(canvasHost, `Interactive 3D preview of a ${shape} miniature base`);
    canvasRef.current = canvas;
    const app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true, alpha: true, powerPreference: "low-power" },
    });
    const host = canvas.parentElement;
    const resize = () => {
      const width = Math.max(1, host?.clientWidth ?? 280);
      const height = Math.max(1, host?.clientHeight ?? 220);
      app.resizeCanvas(width, height);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
    };
    app.setCanvasFillMode(pc.FILLMODE_NONE, Math.max(1, host?.clientWidth ?? 280), Math.max(1, host?.clientHeight ?? 220));
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    const camera = new pc.Entity("Forge preview camera");
    camera.addComponent("camera", { clearColor: new pc.Color(0.02, 0.022, 0.022, 1), nearClip: 0.05, farClip: 50, fov: 36 });
    if (camera.camera) {
      camera.camera.gammaCorrection = pc.GAMMA_SRGB;
      camera.camera.toneMapping = pc.TONEMAP_ACES;
    }
    app.root.addChild(camera);
    camera.setPosition(2.7, 2.25, 3.4);
    camera.lookAt(0, 0.72, 0);

    const lightingRig = createLightingRig(app, camera);
    applyLightingRig(lightingRig, previewMap(lighting));
    rebuildEnvironment(lightingRig, previewMap(lighting));

    const content = new pc.Entity("Miniature turntable");
    app.root.addChild(content);
    const baseHost = new pc.Entity("Scenic base host");
    const miniatureHost = new pc.Entity("Persistent miniature host");
    content.addChild(baseHost); content.addChild(miniatureHost);
    const runtime: PreviewRuntime = { disposed: false, app, content, materials: [], asset: null, pendingAsset: null, objectUrl: "", pendingObjectUrl: "", reducedMotion: resolvedMotionReduction(displaySettings), groundMaterial: null, lighting: lightingRig, miniature: null, modelScale, baseTop: tokenBaseTop(kind === "boss" ? .18 : .14), modelLoadCount: 0, camera, baseHost, miniatureHost, baseHandle: null, cameraMode, lastTextInputAt: Number.NEGATIVE_INFINITY };
    runtimeRef.current = runtime;
    const ground = addPrimitive(runtime, app.root, "Forge shadow catcher", "cylinder", [0, -0.025, 0], [1.85, 0.025, 1.85], "#161714");
    runtime.groundMaterial = runtime.materials.pop() ?? null;
    if (runtime.groundMaterial instanceof pc.StandardMaterial) applyMatteFloorFinish(runtime.groundMaterial, .9);
    if (ground.render) ground.render.castShadows = false;
    const noteTextInput = (event: Event) => {
      if ((event.target as HTMLElement | null)?.matches("input, textarea, select, [contenteditable='true']")) runtime.lastTextInputAt = performance.now();
    };
    document.addEventListener("input", noteTextInput, true);
    document.addEventListener("change", noteTextInput, true);
    const updatePreview = (dt: number) => {
      if (runtime.disposed) return;
      const typingPaused = performance.now() - runtime.lastTextInputAt < 1_400;
      if (!runtime.reducedMotion && !typingPaused) content.rotate(0, dt * 9, 0);
      canvas.dataset.turntableMotion = runtime.reducedMotion ? "reduced" : typingPaused ? "typing-paused" : "rotating";
      runtime.baseHandle?.update(dt);
    };
    app.on("update", updatePreview);
    app.start();
    resize();
    canvas.dataset.previewState = `running:${app.root.children.length}`;
    const observer = new ResizeObserver(resize);
    observer.observe(host ?? canvas);
    return () => {
      runtime.disposed = true;
      app.off("update", updatePreview);
      observer.disconnect();
      document.removeEventListener("input", noteTextInput, true);
      document.removeEventListener("change", noteTextInput, true);
      if (runtime.objectUrl) URL.revokeObjectURL(runtime.objectUrl);
      if (runtime.pendingObjectUrl) URL.revokeObjectURL(runtime.pendingObjectUrl);
      runtime.asset?.unload();
      runtime.pendingAsset?.unload();
      runtime.asset = null;
      runtime.pendingAsset = null;
      runtime.baseHandle?.destroy();
      for (const item of runtime.materials) item.destroy();
      runtime.groundMaterial?.destroy();
      destroyLightingRig(runtime.lighting);
      app.destroy();
      releaseSharedPlayCanvas(canvasHost, canvas);
      canvasRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed) return;
    setModelIssue("");
    const map = previewMap(lighting);
    applyLightingRig(runtime.lighting, map);
    rebuildEnvironment(runtime.lighting, map);
    runtime.reducedMotion = resolvedMotionReduction(displaySettings);
  }, [lighting, displaySettings]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed) return;
    runtime.baseHandle?.destroy();
    runtime.baseHandle = renderBasePlate({ app: runtime.app, parent: runtime.baseHost, token: { name: "Forge miniature", footprint, base: { shape, color: baseColor, accentColor, height: kind === "boss" ? .18 : .14 } }, asset: basePlate, quality: lighting?.quality ?? "balanced", reducedMotion: runtime.reducedMotion, propAssets, materialAssets });
    runtime.baseTop = runtime.baseHandle.anchorTop;
    if (runtime.miniature) groundModelOnBase(runtime.miniature, runtime.miniatureHost, runtime.baseTop, .62);
    if (canvasRef.current) canvasRef.current.dataset.baseRevision = basePlate?.updatedAt ?? `${shape}:${baseColor}:${accentColor}`;
  }, [basePlate, shape, baseColor, accentColor, footprint, kind, lighting?.quality, propAssets, materialAssets]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed) return;
    runtime.cameraMode = cameraMode;
    if (cameraMode === "top") { runtime.camera.setPosition(0, 4.5, .02); runtime.camera.lookAt(0, 0, 0); }
    else { runtime.camera.setPosition(2.7, 2.25, 3.4); runtime.camera.lookAt(0, .72, 0); }
  }, [cameraMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed) return;
    const previewScale = Math.min(1.45, Math.max(0.72, placementScale));
    runtime.content.setLocalScale(previewScale, previewScale, previewScale);
    runtime.modelScale = modelScale;
    if (!model) {
      for (const child of [...runtime.miniatureHost.children]) child.destroy();
      runtime.miniature = null;
      if (runtime.asset) { runtime.asset.unload(); runtime.app.assets.remove(runtime.asset); runtime.asset = null; }
      if (runtime.objectUrl) { URL.revokeObjectURL(runtime.objectUrl); runtime.objectUrl = ""; }
      const placeholder = addPlaceholderMiniature(runtime, runtime.miniatureHost, kind, accentColor, runtime.baseTop, footprint);
      placeholder.setLocalScale(runtime.modelScale, runtime.modelScale, runtime.modelScale);
      runtime.miniature = placeholder;
      groundModelOnBase(placeholder, runtime.miniatureHost, runtime.baseTop);
      if (runtime.cameraMode === "isometric") frameEntityInCamera(runtime.camera, runtime.content);
      if (canvasRef.current) canvasRef.current.dataset.previewState = "placeholder";
      return;
    }
    const previousMiniature = runtime.miniature;
    const previousAsset = runtime.asset;
    const previousObjectUrl = runtime.objectUrl;
    if (!previousMiniature) {
      const placeholder = addPlaceholderMiniature(runtime, runtime.miniatureHost, kind, accentColor, runtime.baseTop, footprint);
      placeholder.setLocalScale(runtime.modelScale, runtime.modelScale, runtime.modelScale);
      runtime.miniature = placeholder;
      groundModelOnBase(placeholder, runtime.miniatureHost, runtime.baseTop);
    }
    const objectUrl = URL.createObjectURL(model);
    const asset = new pc.Asset(model.name, "container", { url: objectUrl, filename: model.name });
    runtime.modelLoadCount += 1;
    if (canvasRef.current) canvasRef.current.dataset.modelLoadCount = String(runtime.modelLoadCount);
    runtime.pendingAsset = asset;
    runtime.pendingObjectUrl = objectUrl;
    asset.on("error", (error: unknown) => {
      if (runtime.disposed || runtime.pendingAsset !== asset) return;
      runtime.pendingAsset = null;
      runtime.pendingObjectUrl = "";
      runtime.app.assets.remove(asset);
      URL.revokeObjectURL(objectUrl);
      setModelIssue(error instanceof Error ? error.message : "The GLB could not be rendered");
      if (canvasRef.current) canvasRef.current.dataset.modelGrounding = "load-error";
    });
    runtime.app.assets.add(asset);
    asset.ready(() => {
      if (runtime.disposed || runtime.pendingAsset !== asset || !asset.resource || !runtime.content.parent) return;
      const resource = asset.resource as { instantiateRenderEntity: () => pc.Entity };
      const instance = resource.instantiateRenderEntity();
      instance.name = `${model.name} 3D preview`;
      instance.setLocalScale(runtime.modelScale, runtime.modelScale, runtime.modelScale);
      for (const render of instance.findComponents("render") as pc.RenderComponent[]) {
        render.castShadows = true;
        render.receiveShadows = true;
        for (const meshInstance of render.meshInstances) {
          if (meshInstance.material instanceof pc.StandardMaterial) {
            applySceneReactiveMiniatureFinish(meshInstance.material);
            applyLightweightAmbientToMaterial(runtime.lighting, meshInstance.material);
            applyMiniatureRimFinish(meshInstance.material);
          }
        }
      }
      runtime.miniatureHost.addChild(instance);
      groundModelOnBase(instance, runtime.miniatureHost, runtime.baseTop, .62);
      const outgoing = runtime.miniature;
      runtime.miniature = instance;
      runtime.asset = asset;
      runtime.objectUrl = objectUrl;
      runtime.pendingAsset = null;
      runtime.pendingObjectUrl = "";
      outgoing?.destroy();
      if (previousAsset && previousAsset !== asset) { previousAsset.unload(); runtime.app.assets.remove(previousAsset); }
      if (previousObjectUrl && previousObjectUrl !== objectUrl) URL.revokeObjectURL(previousObjectUrl);
      if (runtime.cameraMode === "isometric") frameEntityInCamera(runtime.camera, runtime.content);
      if (canvasRef.current) {
        canvasRef.current.dataset.previewState = "model-ready";
        canvasRef.current.dataset.modelGrounding = "render-bounds";
        canvasRef.current.dataset.modelGroundingGap = String(modelBaseGap(instance, runtime.miniatureHost, runtime.baseTop) ?? "unavailable");
      }
    });
    runtime.app.assets.load(asset);
    return () => {
      if (runtime.disposed) { URL.revokeObjectURL(objectUrl); return; }
      if (runtime.pendingAsset !== asset) return;
      runtime.pendingAsset = null;
      runtime.pendingObjectUrl = "";
      asset.unload();
      runtime.app.assets.remove(asset);
      URL.revokeObjectURL(objectUrl);
    };
  }, [model]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed || model || runtime.miniature?.name !== "3D miniature placeholder") return;
    runtime.miniature.destroy();
    const placeholder = addPlaceholderMiniature(runtime, runtime.miniatureHost, kind, accentColor, runtime.baseTop, footprint);
    placeholder.setLocalScale(runtime.modelScale, runtime.modelScale, runtime.modelScale);
    runtime.miniature = placeholder;
    groundModelOnBase(placeholder, runtime.miniatureHost, runtime.baseTop);
  }, [model, kind, accentColor, footprint]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.disposed) return;
    runtime.modelScale = modelScale;
    const previewScale = Math.min(1.45, Math.max(.72, placementScale));
    runtime.content.setLocalScale(previewScale, previewScale, previewScale);
    if (runtime.miniature) {
      runtime.miniature.setLocalScale(modelScale, modelScale, modelScale);
      groundModelOnBase(runtime.miniature, runtime.miniatureHost, runtime.baseTop, .62);
      if (canvasRef.current) {
        canvasRef.current.dataset.modelTransform = `${modelScale.toFixed(2)}:${runtime.miniature.getLocalPosition().y.toFixed(4)}`;
        canvasRef.current.dataset.modelGroundingGap = String(modelBaseGap(runtime.miniature, runtime.miniatureHost, runtime.baseTop) ?? "unavailable");
      }
    }
  }, [modelScale, placementScale]);

  return (
    <figure className="token-model-preview">
      <div ref={canvasHostRef} className="shared-playcanvas-host" />
      {modelIssue && <span className="token-preview-warning" role="status">Model preview failed: {modelIssue}</span>}
      <figcaption>{model ? "Generated 3D miniature + gameplay base" : "Live 3D base preview · model appears here"}</figcaption>
    </figure>
  );
}
