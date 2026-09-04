import * as pc from "playcanvas";
import type { DiceEffects } from "../domain/types";

export type DiceParticleMode = "trail" | "impact";
export interface DiceParticleEmitter {
  entity: pc.Entity;
  duration: number;
}

const textureCache = new WeakMap<pc.GraphicsDevice, Map<string, pc.Texture>>();

const particleTexture = (device: pc.GraphicsDevice, style: DiceEffects["particles"]["style"]): pc.Texture => {
  let cache = textureCache.get(device);
  if (!cache) { cache = new Map(); textureCache.set(device, cache); }
  const existing = cache.get(style);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 64, 64);
  if (style === "sparks") {
    const gradient = context.createLinearGradient(32, 4, 32, 60);
    gradient.addColorStop(0, "rgba(255,255,255,0)"); gradient.addColorStop(.42, "rgba(255,255,255,.9)"); gradient.addColorStop(.5, "white"); gradient.addColorStop(.58, "rgba(255,255,255,.9)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient; context.fillRect(27, 3, 10, 58);
  } else if (style === "stars") {
    context.fillStyle = "white"; context.beginPath();
    for (let point = 0; point < 16; point++) { const angle = point / 16 * Math.PI * 2 - Math.PI / 2; const radius = point % 2 ? 7 : point % 4 === 0 ? 28 : 17; const x = 32 + Math.cos(angle) * radius, y = 32 + Math.sin(angle) * radius; point ? context.lineTo(x, y) : context.moveTo(x, y); }
    context.closePath(); context.fill();
  } else if (style === "snow") {
    context.strokeStyle = "white"; context.lineWidth = 4; context.lineCap = "round";
    for (let arm = 0; arm < 3; arm++) { const angle = arm * Math.PI / 3; context.beginPath(); context.moveTo(32 - Math.cos(angle) * 25, 32 - Math.sin(angle) * 25); context.lineTo(32 + Math.cos(angle) * 25, 32 + Math.sin(angle) * 25); context.stroke(); }
  } else {
    const gradient = context.createRadialGradient(32, 32, style === "embers" ? 3 : 1, 32, 32, style === "smoke" ? 31 : 25);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(style === "smoke" ? .28 : .45, style === "smoke" ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  }
  const texture = new pc.Texture(device, { name: `${style} dice particle`, width: 64, height: 64, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
  texture.setSource(canvas);
  cache.set(style, texture);
  return texture;
};

const rgb = (value: string): [number, number, number] => {
  const normalized = value.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255) as [number, number, number];
};

const permits = (profile: DiceEffects["particles"], mode: DiceParticleMode): boolean => profile.enabled && (profile.emission === "both" || profile.emission === mode);

/** Creates one bounded billboard emitter. PlayCanvas uses GPU simulation when the device supports it. */
export function createDiceParticleEmitter(app: pc.Application, profile: DiceEffects["particles"], mode: DiceParticleMode, name: string): DiceParticleEmitter | null {
  if (!permits(profile, mode)) return null;
  const primary = rgb(profile.color);
  const secondary = rgb(profile.secondaryColor);
  const loop = mode === "trail";
  const rate = loop ? Math.max(.012, profile.lifetime / profile.count) : Math.max(.004, Math.min(.018, profile.lifetime / profile.count * .55));
  const emissionDuration = loop ? profile.lifetime : rate * profile.count;
  const emitter = new pc.Entity(name);
  emitter.addComponent("particlesystem", {
    autoPlay: true,
    numParticles: profile.count,
    lifetime: profile.lifetime,
    rate,
    rate2: rate * (1 + profile.turbulence * .7),
    loop,
    preWarm: false,
    lighting: false,
    intensity: 1.25,
    depthWrite: false,
    noFog: true,
    blendType: profile.style === "smoke" ? pc.BLEND_NORMAL : pc.BLEND_ADDITIVE,
    sort: pc.PARTICLESORT_NONE,
    stretch: profile.style === "sparks" ? .45 : 0,
    alignToMotion: profile.style === "sparks" || profile.style === "embers",
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: profile.spread * (mode === "impact" ? .24 : .045),
    emitterRadiusInner: mode === "impact" ? profile.spread * .04 : 0,
    initialVelocity: profile.speed * (mode === "impact" ? 1 : .28),
    localSpace: false,
    colorMap: particleTexture(app.graphicsDevice, profile.style),
    colorGraph: new pc.CurveSet([
      [0, primary[0], .58, secondary[0], 1, secondary[0]],
      [0, primary[1], .58, secondary[1], 1, secondary[1]],
      [0, primary[2], .58, secondary[2], 1, secondary[2]],
    ]),
    alphaGraph: new pc.Curve([0, 0, .08, 1, .68, .72, 1, 0]),
    scaleGraph: new pc.Curve([0, profile.size * .35, .16, profile.size, .72, profile.size * .7, 1, 0]),
    velocityGraph: new pc.CurveSet([
      [0, -profile.turbulence * .12, .5, profile.turbulence * .12, 1, -profile.turbulence * .06],
      [0, profile.gravity * .1, 1, profile.gravity],
      [0, profile.turbulence * .1, .5, -profile.turbulence * .12, 1, profile.turbulence * .05],
    ]),
    rotationSpeedGraph: new pc.Curve([0, -90 - profile.turbulence * 180, 1, 90 + profile.turbulence * 180]),
  });
  app.root.addChild(emitter);
  return { entity: emitter, duration: emissionDuration + profile.lifetime };
}
