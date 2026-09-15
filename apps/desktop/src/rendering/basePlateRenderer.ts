import * as pc from "playcanvas";
import { basePlateParticleBudget, validateBasePlateRecipe } from "../domain/baseplates";
import { tokenBaseGeometry } from "../domain/tokenGeometry";
import type { BasePlateAsset, BasePlateLayer, LightingQuality, MaterialAsset, PropAsset, TokenAsset, TokenBaseShape } from "../domain/types";
import { getStoredPropModel } from "../persistence/propAssets";
import { applyMaterialAsset } from "./customMaterialAsset";
import { parseNativeGlb } from "../migration/nativeGlb";
import { fitScenicBase, isScenicBaseSurface, sceneryHeightRatio } from "./scenicBaseGeometry";

export interface BasePlateRenderOptions {
  app: pc.Application;
  parent: pc.Entity;
  token: Pick<TokenAsset, "footprint" | "base" | "name">;
  asset?: BasePlateAsset;
  quality: LightingQuality;
  reducedMotion: boolean;
  propAssets?: PropAsset[];
  materialAssets?: MaterialAsset[];
  onFitWarning?: (message:string) => void;
  onAnchorTopChanged?: (height: number, offset: { x: number; z: number }) => void;
}

export interface BasePlateRenderHandle {
  root: pc.Entity;
  anchorTop: number;
  update: (dt: number) => void;
  destroy: () => void;
}

const parseColor = (hex: string): pc.Color => new pc.Color().fromString(/^#[\da-f]{6}$/i.test(hex) ? hex : "#777777");

const makeMaterial = (hex: string, gloss = .48, emissive = 0): pc.StandardMaterial => {
  const material = new pc.StandardMaterial();
  material.diffuse = parseColor(hex);
  material.metalness = .05;
  material.gloss = gloss;
  // The shared preview and board both retain the authored colour even when a
  // base sits entirely inside the miniature's contact shadow.
  material.emissive = parseColor(hex);
  material.emissiveIntensity = Math.max(.035, emissive);
  material.update();
  return material;
};

function addShape(app: pc.Application, parent: pc.Entity, shape: TokenBaseShape, name: string, material: pc.Material, diameter: number, height: number, y: number): pc.Entity {
  const entity = new pc.Entity(name);
  const geometry = tokenBaseGeometry(shape);
  if (geometry.capSegments) entity.addComponent("render", { meshInstances: [new pc.MeshInstance(pc.createCylinder(app.graphicsDevice, { height: 1, radius: .5, capSegments: geometry.capSegments }), material)] });
  else { entity.addComponent("render", { type: geometry.primitive }); if (entity.render) entity.render.material = material; }
  entity.setLocalPosition(0, y, 0);
  entity.setLocalScale(diameter, height, diameter);
  if (entity.render) { entity.render.castShadows = true; entity.render.receiveShadows = true; }
  parent.addChild(entity);
  return entity;
}

function addDecoration(parent: pc.Entity, layer: BasePlateLayer, material: pc.Material, index: number): pc.Entity {
  const entity = new pc.Entity(layer.propAssetId ? `Relink prop ${layer.propAssetId}` : layer.name);
  const type = layer.propAssetId ? "box" : index % 2 ? "sphere" : "cylinder";
  entity.addComponent("render", { type });
  const radius = Math.min(.34, Math.max(.06, layer.scale.x));
  entity.setLocalPosition(layer.position.x, Math.max(.035, layer.position.y), layer.position.z);
  entity.setLocalEulerAngles(layer.rotation.x, layer.rotation.y, layer.rotation.z);
  entity.setLocalScale(radius, Math.min(.22, Math.max(.025, layer.scale.y)), Math.min(.34, Math.max(.06, layer.scale.z)));
  if (entity.render) { entity.render.material = material; entity.render.castShadows = true; entity.render.receiveShadows = true; }
  parent.addChild(entity);
  return entity;
}

export function renderBasePlate(options: BasePlateRenderOptions): BasePlateRenderHandle {
  const root = new pc.Entity(`${options.token.name} scenic base root`);
  root.tags.add("scenic-base-root");
  options.parent.addChild(root);
  const recipe = options.asset ? validateBasePlateRecipe(options.asset.recipe) : undefined;
  const shape = recipe?.visualShape && recipe.visualShape !== "inherit" ? recipe.visualShape : options.token.base.shape;
  const height = recipe?.plinthHeight ?? options.token.base.height;
  const diameter = options.token.footprint * 2;
  const materials: pc.Material[] = [];
  const modelAssets: pc.Asset[] = [];
  const animated: { entity: pc.Entity; layer: BasePlateLayer; phase: number }[] = [];
  const particles: { entity: pc.Entity; phase: number; radius: number; baseY: number; speed: number }[] = [];
  let remainingParticles = basePlateParticleBudget(options.quality, options.reducedMotion);
  const material = (hex: string, gloss?: number, glow?: number) => { const next = makeMaterial(hex, gloss, glow); materials.push(next); return next; };

  let anchorTop = height + .06;
  const plinth = addShape(options.app, root, shape, "Rules-locked plinth", material(recipe?.plinthColor ?? options.token.base.color, .54), diameter, height, height / 2);
  const rim = addShape(options.app, root, shape, "Painted rim", material(recipe?.rimColor ?? options.token.base.accentColor, .68), diameter * .94, .026, height + .013);
  if (recipe) {
    for (const [index, layer] of recipe.layers.filter((entry) => entry.enabled && entry.kind !== "plinth").entries()) {
      if (layer.kind === "surface") {
        const surface = addShape(options.app, root, shape, layer.name, material(layer.color ?? recipe.rimColor, recipe.preset === "pond" || recipe.preset === "swamp" ? .82 : .38), diameter * .89, Math.max(.012, recipe.surfaceRelief * .18), height + .032);
        const authoredMaterial = options.materialAssets?.find((asset) => asset.id === layer.materialAssetId);
        if (authoredMaterial) void applyMaterialAsset(options.app, surface, authoredMaterial);
      } else if (layer.kind === "decoration" || layer.kind === "prop") {
        const reusableProp = options.propAssets?.find((asset) => asset.id === layer.propAssetId);
        if (layer.propAssetId && reusableProp) {
          void getStoredPropModel(reusableProp.storageKey).then((contents) => {
            if (!root.parent) return;
            if (!contents) {
              addDecoration(root, { ...layer, name: `Relink missing prop ${reusableProp.name}`, color: "#a13f51", position: { ...layer.position, y: height + .055 + layer.position.y } }, material("#a13f51", .3), index);
              return;
            }
            const fit = isScenicBaseSurface(layer) ? fitScenicBase(parseNativeGlb({ bytes: contents }, reusableProp.id).parts.map(part => part.geometry), diameter, sceneryHeightRatio(recipe), recipe.standingPoint) : undefined;
            const asset = new pc.Asset(reusableProp.name, "container", { url: `memory://dndrom/baseplate/${encodeURIComponent(reusableProp.id)}.glb`, filename: reusableProp.filename, contents, size: reusableProp.byteLength });
            modelAssets.push(asset); options.app.assets.add(asset);
            const attach = () => {
              if (!asset.resource || !root.parent) return;
              const instance = (asset.resource as { instantiateRenderEntity: () => pc.Entity }).instantiateRenderEntity();
              instance.name = `${reusableProp.name} base decoration`;
              instance.setLocalEulerAngles(layer.rotation.x, layer.rotation.y, layer.rotation.z);
              const width = Math.max(.001, reusableProp.bounds.max.x - reusableProp.bounds.min.x, reusableProp.bounds.max.z - reusableProp.bounds.min.z);
              const maxScale = Math.min(4, Math.max(.01, (diameter * .86 / width) * layer.scale.x));
              const sourceHeight = Math.max(.001, reusableProp.bounds.max.y - reusableProp.bounds.min.y);
              const shallowScale = Math.min(maxScale, diameter * .32 / sourceHeight);
              const centerX = (reusableProp.bounds.min.x + reusableProp.bounds.max.x) * .5;
              const centerZ = (reusableProp.bounds.min.z + reusableProp.bounds.max.z) * .5;
              instance.setLocalScale(maxScale, shallowScale, maxScale);
              instance.setLocalPosition(layer.position.x - centerX * maxScale, height + .032 + layer.position.y - reusableProp.bounds.min.y * shallowScale, layer.position.z - centerZ * maxScale);
              root.addChild(instance);
              if (fit) {
                instance.setLocalEulerAngles(0, layer.rotation.y, 0);
                instance.setLocalScale(fit.scale.x, fit.scale.y, fit.scale.z);
                // Rotate the centering offset along with the plate.
                const centered = new pc.Quat().setFromEulerAngles(0, layer.rotation.y, 0).transformVector(new pc.Vec3(fit.position.x, fit.position.y, fit.position.z));
                instance.setLocalPosition(centered);
                plinth.enabled = false; rim.enabled = false;
                anchorTop = fit.anchorTop; const anchor = new pc.Quat().setFromEulerAngles(0, layer.rotation.y, 0).transformVector(new pc.Vec3(fit.anchorOffset.x, 0, fit.anchorOffset.z)); options.onAnchorTopChanged?.(anchorTop, {x:anchor.x,z:anchor.z});
                options.onFitWarning?.(fit.exceedsHeightBudget ? 'This saved mesh exceeds the scenery height limit. Its proportions are preserved; regenerate a shallower reference for a low base.' : !fit.hasStandingSurface ? 'This mesh has no clear standing area. Regenerate it with a flat centre.' : '');
                root.tags.add('scenic-surface-replacement');
              }
            };
            asset.ready(attach); options.app.assets.load(asset);
          }).catch(error => console.error('Scenic base could not be loaded; keeping its fallback base visible.', error));
          continue;
        }
        // Recipe-only decoration concepts are descriptive metadata. They must
        // never turn into arbitrary spheres/cylinders on a player's base.
        if (layer.kind === "prop" && layer.propAssetId) addDecoration(root, { ...layer, name: `Relink missing generated mesh`, color: "#a13f51", position: { ...layer.position, y: height + .055 + layer.position.y } }, material("#a13f51", .3), index);
      } else if (layer.kind === "effect" && layer.effect) {
        const glow = layer.effect.kind === "glow" ? layer.effect.intensity : .08;
        const effectEntity = addShape(options.app, root, shape, layer.name, material(layer.effect.color, .86, glow), diameter * (.78 + (layer.overhang ?? 0)), .008, height + .055);
        effectEntity.render && (effectEntity.render.castShadows = false);
        animated.push({ entity: effectEntity, layer, phase: index * .7 });
        const requested = Math.min(remainingParticles, layer.effect.particleCount ?? 0);
        remainingParticles -= requested;
        for (let particleIndex = 0; particleIndex < requested; particleIndex += 1) {
          const particle = new pc.Entity(`${layer.effect.kind} particle ${particleIndex + 1}`);
          particle.addComponent("render", { type: layer.effect.kind === "petals" ? "plane" : "sphere" });
          const particleMaterial = material(layer.effect.color, .72, layer.effect.intensity * .5);
          if (particle.render) { particle.render.material = particleMaterial; particle.render.castShadows = false; particle.render.receiveShadows = false; }
          const phase = particleIndex / Math.max(1, requested) * Math.PI * 2;
          const radius = (.18 + (particleIndex % 5) * .09) * options.token.footprint;
          const baseY = height + .1 + (particleIndex % 4) * .045;
          particle.setLocalPosition(Math.cos(phase) * radius, baseY, Math.sin(phase) * radius);
          particle.setLocalScale(.018, .018, .018);
          root.addChild(particle);
          particles.push({ entity: particle, phase, radius, baseY, speed: layer.effect.speed * (.45 + (particleIndex % 3) * .18) });
        }
      }
    }
  }
  root.tags.add(`particle-budget:${basePlateParticleBudget(options.quality, options.reducedMotion)}`);
  return {
    root,
    get anchorTop() { return anchorTop; },
    update: (dt) => {
      if (options.reducedMotion) return;
      for (const item of animated) {
        item.phase += dt * (item.layer.effect?.speed ?? 0);
        const pulse = 1 + Math.sin(item.phase * Math.PI * 2) * .012 * (item.layer.effect?.intensity ?? 0);
        item.entity.setLocalScale(diameter * .78 * pulse, .008, diameter * .78 * pulse);
      }
      for (const particle of particles) {
        particle.phase += dt * particle.speed;
        particle.entity.setLocalPosition(Math.cos(particle.phase) * particle.radius, particle.baseY + Math.sin(particle.phase * 1.7) * .035, Math.sin(particle.phase) * particle.radius);
      }
    },
    destroy: () => { root.destroy(); for (const item of materials) item.destroy(); for (const asset of modelAssets) { asset.unload(); options.app.assets.remove(asset); } },
  };
}
