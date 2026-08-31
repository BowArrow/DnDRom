import { useEffect, useRef, useState } from "react";
import * as pc from "playcanvas";
import { ASSET_BY_ID, type AssetDefinition, type AssetPart } from "../domain/assets";
import type { GameMap, MapEntity, Vec3 } from "../domain/types";
import { getStoredSplatResponse } from "../persistence/splatAssets";

interface SceneViewportProps {
  map: GameMap;
  selectedEntityId: string | null;
  activeAssetId: string | null;
  showGrid: boolean;
  onPlace: (position: Vec3) => void;
  onSelect: (id: string | null) => void;
}

interface RuntimeScene {
  app: pc.Application;
  camera: pc.Entity;
  contentRoot: pc.Entity;
  selectionRoot: pc.Entity;
  objectRoots: Map<string, pc.Entity>;
  modelAssets: Map<string, pc.Asset>;
  splatAssets: Map<string, pc.Asset>;
  sceneryRoots: Map<string, pc.Entity>;
  materials: Map<string, pc.StandardMaterial>;
  gridRoot: pc.Entity;
  orbit: { yaw: number; pitch: number; distance: number; target: pc.Vec3 };
}

const syncScenery = async (runtime: RuntimeScene, map: GameMap): Promise<string | null> => {
  const scenery = (map.scenery ?? []).filter((entry) => entry.enabled);
  const expected = new Set(scenery.map((entry) => entry.id));
  for (const [id, root] of runtime.sceneryRoots) {
    if (!expected.has(id)) {
      root.destroy();
      runtime.sceneryRoots.delete(id);
      const asset = runtime.splatAssets.get(id);
      if (asset) {
        asset.unload();
        runtime.app.assets.remove(asset);
        runtime.splatAssets.delete(id);
      }
    }
  }
  for (const entry of scenery) {
    let root = runtime.sceneryRoots.get(entry.id);
    if (!root) {
      const contents = await getStoredSplatResponse(entry.storageKey);
      if (!contents) return `${entry.name} is not stored on this device. Re-import its ${entry.format.toUpperCase()} file.`;
      const concurrentlyCreated = runtime.sceneryRoots.get(entry.id);
      if (concurrentlyCreated) {
        root = concurrentlyCreated;
        continue;
      }
      root = new pc.Entity(entry.name);
      root.tags.add("presentation-scenery", entry.id);
      runtime.contentRoot.addChild(root);
      runtime.sceneryRoots.set(entry.id, root);
      const extension = entry.format === "sog" ? "sog" : "ply";
      const asset = new pc.Asset(entry.name, "gsplat", {
        url: `memory://dndrom/${entry.id}.${extension}`,
        filename: entry.filename,
        size: entry.byteLength,
        // PlayCanvas' runtime PLY parser accepts a Response here; its AssetFile
        // declaration still types `contents` as ArrayBuffer.
        contents: contents as unknown as ArrayBuffer,
      });
      runtime.splatAssets.set(entry.id, asset);
      runtime.app.assets.add(asset);
      root.addComponent("gsplat", { asset });
      runtime.app.assets.load(asset);
    }
    root.enabled = entry.enabled;
    root.setPosition(entry.position.x, entry.position.y, entry.position.z);
    root.setEulerAngles(entry.rotation.x, entry.rotation.y, entry.rotation.z);
    root.setLocalScale(entry.scale.x, entry.scale.y, entry.scale.z);
  }
  return null;
};

const toColor = (hex: string): pc.Color => {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3 ? normalized.split("").map((entry) => entry + entry).join("") : normalized, 16);
  return new pc.Color(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

const materialFor = (runtime: RuntimeScene, color: string, emissive?: string): pc.StandardMaterial => {
  const key = `${color}:${emissive ?? ""}`;
  const existing = runtime.materials.get(key);
  if (existing) return existing;
  const material = new pc.StandardMaterial();
  material.diffuse = toColor(color);
  material.metalness = 0.02;
  material.gloss = 0.28;
  if (emissive) {
    material.emissive = toColor(emissive);
    material.emissiveIntensity = 3;
  }
  material.update();
  runtime.materials.set(key, material);
  return material;
};

const addPart = (runtime: RuntimeScene, parent: pc.Entity, definition: AssetPart): void => {
  const child = new pc.Entity();
  child.addComponent("render", { type: definition.primitive });
  child.setLocalPosition(definition.position.x, definition.position.y, definition.position.z);
  child.setLocalScale(definition.scale.x, definition.scale.y, definition.scale.z);
  if (definition.rotation) child.setLocalEulerAngles(definition.rotation.x, definition.rotation.y, definition.rotation.z);
  if (child.render) child.render.material = materialFor(runtime, definition.color, definition.emissive);
  parent.addChild(child);
};

const createFallback = (runtime: RuntimeScene, parent: pc.Entity, definition: AssetDefinition): void => {
  const child = new pc.Entity();
  child.addComponent("render", { type: "box" });
  child.setLocalPosition(0, 0.5, 0);
  child.setLocalScale(definition.footprint, 1, definition.footprint);
  if (child.render) child.render.material = materialFor(runtime, "#805b89");
  parent.addChild(child);
};

const loadModel = (runtime: RuntimeScene, parent: pc.Entity, definition: AssetDefinition): void => {
  if (!definition.modelUrl) return;
  let asset = runtime.modelAssets.get(definition.modelUrl);
  if (!asset) {
    asset = new pc.Asset(definition.name, "container", { url: definition.modelUrl });
    runtime.modelAssets.set(definition.modelUrl, asset);
    runtime.app.assets.add(asset);
    runtime.app.assets.load(asset);
  }
  const attach = () => {
    if (!parent.parent || !asset?.resource) return;
    const resource = asset.resource as { instantiateRenderEntity: () => pc.Entity };
    const instance = resource.instantiateRenderEntity();
    const scale = definition.modelScale ?? 1;
    instance.setLocalScale(scale, scale, scale);
    parent.addChild(instance);
  };
  if (asset.resource) attach();
  else {
    createFallback(runtime, parent, definition);
    asset.ready(() => {
      for (const child of [...parent.children]) child.destroy();
      attach();
    });
    asset.on("error", () => {
      if (parent.children.length === 0) createFallback(runtime, parent, definition);
    });
  }
};

const createMapObject = (runtime: RuntimeScene, mapEntity: MapEntity): pc.Entity => {
  const root = new pc.Entity(mapEntity.name);
  root.tags.add("map-object", mapEntity.id);
  const definition = ASSET_BY_ID.get(mapEntity.assetId);
  if (definition?.parts) definition.parts.forEach((part) => addPart(runtime, root, part));
  else if (definition?.modelUrl) loadModel(runtime, root, definition);
  else if (definition) createFallback(runtime, root, definition);
  root.enabled = !mapEntity.hidden;
  runtime.contentRoot.addChild(root);
  return root;
};

const syncObjects = (runtime: RuntimeScene, map: GameMap): void => {
  const expected = new Set(map.entities.map((entry) => entry.id));
  for (const [id, root] of runtime.objectRoots) {
    if (!expected.has(id)) {
      root.destroy();
      runtime.objectRoots.delete(id);
    }
  }
  for (const mapEntity of map.entities) {
    let root = runtime.objectRoots.get(mapEntity.id);
    if (!root) {
      root = createMapObject(runtime, mapEntity);
      runtime.objectRoots.set(mapEntity.id, root);
    }
    root.enabled = !mapEntity.hidden;
    root.setPosition(mapEntity.position.x, mapEntity.position.y, mapEntity.position.z);
    root.setEulerAngles(mapEntity.rotation.x, mapEntity.rotation.y, mapEntity.rotation.z);
    root.setLocalScale(mapEntity.scale.x, mapEntity.scale.y, mapEntity.scale.z);
  }
};

const rebuildGrid = (runtime: RuntimeScene, map: GameMap, showGrid: boolean): void => {
  for (const child of [...runtime.gridRoot.children]) child.destroy();
  runtime.gridRoot.enabled = showGrid;
  if (!showGrid) return;
  const gridMaterial = materialFor(runtime, "#4f514e");
  const majorMaterial = materialFor(runtime, "#70736e");
  const width = Math.min(60, Math.max(8, map.width));
  const depth = Math.min(60, Math.max(8, map.depth));
  for (let x = -width / 2; x <= width / 2; x += map.gridSize) {
    const line = new pc.Entity();
    line.addComponent("render", { type: "box" });
    line.setLocalPosition(x, 0.006, 0);
    line.setLocalScale(x % 5 === 0 ? 0.025 : 0.012, 0.008, depth);
    if (line.render) line.render.material = x % 5 === 0 ? majorMaterial : gridMaterial;
    runtime.gridRoot.addChild(line);
  }
  for (let z = -depth / 2; z <= depth / 2; z += map.gridSize) {
    const line = new pc.Entity();
    line.addComponent("render", { type: "box" });
    line.setLocalPosition(0, 0.007, z);
    line.setLocalScale(width, 0.008, z % 5 === 0 ? 0.025 : 0.012);
    if (line.render) line.render.material = z % 5 === 0 ? majorMaterial : gridMaterial;
    runtime.gridRoot.addChild(line);
  }
};

const updateCamera = (runtime: RuntimeScene): void => {
  const { yaw, pitch, distance, target } = runtime.orbit;
  const yawRadians = yaw * pc.math.DEG_TO_RAD;
  const pitchRadians = pitch * pc.math.DEG_TO_RAD;
  const horizontal = distance * Math.cos(pitchRadians);
  runtime.camera.setPosition(
    target.x + Math.sin(yawRadians) * horizontal,
    target.y + Math.sin(pitchRadians) * distance,
    target.z + Math.cos(yawRadians) * horizontal,
  );
  runtime.camera.lookAt(target);
};

const groundPoint = (runtime: RuntimeScene, canvas: HTMLCanvasElement, clientX: number, clientY: number): pc.Vec3 | null => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;
  const near = runtime.camera.camera?.screenToWorld(x, y, 0.1);
  const far = runtime.camera.camera?.screenToWorld(x, y, 1000);
  if (!near || !far) return null;
  const direction = far.clone().sub(near);
  if (Math.abs(direction.y) < 0.0001) return null;
  const distance = -near.y / direction.y;
  if (distance < 0) return null;
  return near.clone().add(direction.mulScalar(distance));
};

export function SceneViewport({ map, selectedEntityId, activeAssetId, showGrid, onPlace, onSelect }: SceneViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<RuntimeScene | null>(null);
  const callbacksRef = useRef({ onPlace, onSelect, activeAssetId, map });
  const [ready, setReady] = useState(false);
  const [splatIssue, setSplatIssue] = useState<string | null>(null);

  callbacksRef.current = { onPlace, onSelect, activeAssetId, map };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const app = new pc.Application(canvas, {
      keyboard: new pc.Keyboard(window),
      mouse: new pc.Mouse(canvas),
      touch: "ontouchstart" in window ? new pc.TouchDevice(canvas) : undefined,
      graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: "high-performance" },
    });
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.scene.ambientLight = new pc.Color(0.32, 0.33, 0.36);
    app.scene.gsplat.splatBudget = 2_000_000;

    const camera = new pc.Entity("Camera");
    camera.addComponent("camera", { clearColor: new pc.Color(0.035, 0.04, 0.045), farClip: 250, fov: 52 });
    if (camera.camera) {
      camera.camera.gammaCorrection = pc.GAMMA_SRGB;
      camera.camera.toneMapping = pc.TONEMAP_ACES;
    }
    app.root.addChild(camera);

    const sun = new pc.Entity("Sun");
    sun.addComponent("light", { type: "directional", color: new pc.Color(1, 0.88, 0.72), intensity: 1.6, castShadows: true, shadowDistance: 70, shadowResolution: 1024 });
    sun.setEulerAngles(52, 32, 0);
    app.root.addChild(sun);

    const fill = new pc.Entity("Fill");
    fill.addComponent("light", { type: "omni", color: new pc.Color(0.25, 0.42, 0.65), intensity: 0.7, range: 28 });
    fill.setPosition(-6, 8, -4);
    app.root.addChild(fill);

    const contentRoot = new pc.Entity("Map Content");
    const gridRoot = new pc.Entity("Grid");
    const selectionRoot = new pc.Entity("Selection");
    app.root.addChild(contentRoot);
    app.root.addChild(gridRoot);
    app.root.addChild(selectionRoot);

    const runtime: RuntimeScene = {
      app,
      camera,
      contentRoot,
      selectionRoot,
      gridRoot,
      objectRoots: new Map(),
      modelAssets: new Map(),
      splatAssets: new Map(),
      sceneryRoots: new Map(),
      materials: new Map(),
      orbit: { yaw: 38, pitch: 52, distance: Math.max(25, Math.max(callbacksRef.current.map.width, callbacksRef.current.map.depth) * 1.05), target: new pc.Vec3(0, 0, 0) },
    };
    runtimeRef.current = runtime;
    updateCamera(runtime);
    syncObjects(runtime, callbacksRef.current.map);
    void syncScenery(runtime, callbacksRef.current.map).then(setSplatIssue).catch((error) => setSplatIssue(error instanceof Error ? error.message : "Splat scenery failed to load"));
    rebuildGrid(runtime, callbacksRef.current.map, showGrid);
    app.start();
    setReady(true);

    const resizeObserver = new ResizeObserver(() => app.resizeCanvas());
    resizeObserver.observe(canvas.parentElement ?? canvas);

    let pointerStart: { x: number; y: number } | null = null;
    let lastPointer: { x: number; y: number } | null = null;
    let orbiting = false;
    let panning = false;

    const pointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointerStart = { x: event.clientX, y: event.clientY };
      lastPointer = { ...pointerStart };
      orbiting = event.button === 2 || (event.button === 0 && event.altKey);
      panning = event.button === 1 || (event.button === 0 && event.shiftKey);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!lastPointer) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      if (orbiting) {
        runtime.orbit.yaw -= dx * 0.35;
        runtime.orbit.pitch = pc.math.clamp(runtime.orbit.pitch + dy * 0.28, 22, 82);
        updateCamera(runtime);
      } else if (panning) {
        const scale = runtime.orbit.distance * 0.0025;
        const yaw = runtime.orbit.yaw * pc.math.DEG_TO_RAD;
        runtime.orbit.target.x -= (Math.cos(yaw) * dx + Math.sin(yaw) * dy) * scale;
        runtime.orbit.target.z -= (-Math.sin(yaw) * dx + Math.cos(yaw) * dy) * scale;
        updateCamera(runtime);
      }
      lastPointer = { x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      const moved = pointerStart ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) : 999;
      if (!orbiting && !panning && moved < 5 && event.button === 0) {
        const point = groundPoint(runtime, canvas, event.clientX, event.clientY);
        if (point) {
          if (callbacksRef.current.activeAssetId) callbacksRef.current.onPlace({ x: Math.round(point.x), y: 0, z: Math.round(point.z) });
          else {
            let nearest: { id: string; distance: number } | null = null;
            for (const entry of callbacksRef.current.map.entities) {
              if (entry.hidden) continue;
              const distance = Math.hypot(entry.position.x - point.x, entry.position.z - point.z);
              const footprint = ASSET_BY_ID.get(entry.assetId)?.footprint ?? 0.7;
              if (distance <= footprint * Math.max(entry.scale.x, entry.scale.z) + 0.45 && (!nearest || distance < nearest.distance)) nearest = { id: entry.id, distance };
            }
            callbacksRef.current.onSelect(nearest?.id ?? null);
          }
        }
      }
      pointerStart = null;
      lastPointer = null;
      orbiting = false;
      panning = false;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      runtime.orbit.distance = pc.math.clamp(runtime.orbit.distance * (1 + event.deltaY * 0.001), 6, 90);
      updateCamera(runtime);
    };
    const contextMenu = (event: MouseEvent) => event.preventDefault();

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", contextMenu);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", contextMenu);
      app.destroy();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) {
      syncObjects(runtime, map);
      runtime.orbit.target.set(0, 0, 0);
      runtime.orbit.distance = Math.max(25, Math.max(map.width, map.depth) * 1.05);
      updateCamera(runtime);
    }
  }, [map.id]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) syncObjects(runtime, map);
  }, [map.entities, map.ambientColor]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    void syncScenery(runtime, map).then(setSplatIssue).catch((error) => setSplatIssue(error instanceof Error ? error.message : "Splat scenery failed to load"));
  }, [map.id, map.scenery]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) rebuildGrid(runtime, map, showGrid);
  }, [map.width, map.depth, map.gridSize, showGrid]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    for (const child of [...runtime.selectionRoot.children]) child.destroy();
    if (!selectedEntityId) return;
    const selected = map.entities.find((entry) => entry.id === selectedEntityId);
    if (!selected) return;
    const marker = new pc.Entity("Selection marker");
    marker.addComponent("render", { type: "cylinder" });
    const footprint = (ASSET_BY_ID.get(selected.assetId)?.footprint ?? 0.7) * Math.max(selected.scale.x, selected.scale.z);
    marker.setPosition(selected.position.x, selected.position.y + 0.025, selected.position.z);
    marker.setLocalScale(footprint * 2.2, 0.025, footprint * 2.2);
    if (marker.render) {
      const selectionMaterial = materialFor(runtime, "#d7aa55", "#8a5b1e");
      selectionMaterial.opacity = 0.4;
      selectionMaterial.blendType = pc.BLEND_NORMAL;
      selectionMaterial.update();
      marker.render.material = selectionMaterial;
    }
    runtime.selectionRoot.addChild(marker);
  }, [selectedEntityId, map.entities]);

  return (
    <div className="scene-viewport">
      <canvas ref={canvasRef} aria-label="3D tabletop map" />
      {!ready && <div className="scene-loading">Lighting the table…</div>}
      {splatIssue && <div className="scene-splat-warning">{splatIssue}</div>}
      <div className="scene-help">Right drag: orbit · Shift drag: pan · Wheel: zoom · Click: {activeAssetId ? "place" : "select"}</div>
      <div className="scene-badge">{map.theme} · {map.entities.length} objects{map.scenery?.some((entry) => entry.enabled) ? ` · ${map.scenery.filter((entry) => entry.enabled).length} splat` : ""}</div>
    </div>
  );
}
