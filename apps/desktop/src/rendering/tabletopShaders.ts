import * as pc from "playcanvas";
import { WORLD_VISUAL_CONFIG } from "../domain/worldVisualConfig";

const shader = (name: string, vertexGLSL: string, fragmentGLSL: string, attributes: Record<string, string>): pc.ShaderMaterial => new pc.ShaderMaterial({
  uniqueName: `dndrom-${name}-v1`,
  attributes,
  vertexGLSL,
  fragmentGLSL,
});

const WORLD_VERTEX = `
attribute vec3 aPosition;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vWorldPos;
void main(void) {
  vec4 world = matrix_model * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  gl_Position = matrix_viewProjection * world;
}`;

export type WorldGridShape = "square" | "hex";

export const createWorldGridMaterial = (gridSize: number, cameraPosition: pc.Vec3, shape: WorldGridShape = "square"): pc.ShaderMaterial => {
  const material = shader("world-grid", WORLD_VERTEX, `
precision highp float;
uniform vec4 uGridColor;
uniform vec4 uMajorColor;
uniform float uGridCellSize;
uniform float uGridLineWidth;
uniform float uGridFadeDistance;
uniform float uGridShape;
uniform vec3 uCameraPosition;
varying vec3 vWorldPos;

float gridLine(vec2 coordinate, float width) {
  vec2 distanceToLine = abs(fract(coordinate - 0.5) - 0.5);
  vec2 derivative = max(fwidth(coordinate), vec2(0.0001));
  vec2 pixelDistance = distanceToLine / derivative;
  return 1.0 - smoothstep(width, width + 1.0, min(pixelDistance.x, pixelDistance.y));
}

float hexDistance(vec2 value) {
  value = abs(value);
  return max(dot(value, normalize(vec2(1.0, 1.7320508))), value.x);
}

float hexLine(vec2 worldPosition, float size, float thickness) {
  vec2 p = worldPosition / max(size, .0001);
  vec2 repeatSize = vec2(1.0, 1.7320508);
  vec2 halfRepeat = repeatSize * .5;
  vec2 cellA = mod(p, repeatSize) - halfRepeat;
  vec2 cellB = mod(p - halfRepeat, repeatSize) - halfRepeat;
  vec2 nearest = dot(cellA, cellA) < dot(cellB, cellB) ? cellA : cellB;
  float edgeDistance = abs(.5 - hexDistance(nearest));
  float antialias = max(fwidth(edgeDistance), .00045);
  return 1.0 - smoothstep(thickness - antialias, thickness + antialias, edgeDistance);
}

void main(void) {
  vec2 coordinate = vWorldPos.xz / uGridCellSize;
  float squareMinor = gridLine(coordinate, uGridLineWidth);
  float squareMajor = gridLine(coordinate / 5.0, uGridLineWidth * .6);
  float hexMinor = hexLine(vWorldPos.xz, uGridCellSize, .024);
  float minor = mix(squareMinor, hexMinor, uGridShape);
  // Major square divisions are useful for rulers; nested five-cell hexagons
  // are not a valid hex lattice and read as large rings over the artwork.
  float major = mix(squareMajor, 0.0, uGridShape);
  float distanceFade = 1.0 - smoothstep(uGridFadeDistance * 0.45, uGridFadeDistance, length(vWorldPos - uCameraPosition));
  vec4 color = mix(uGridColor, uMajorColor, major);
  color.a *= max(minor, major) * distanceFade;
  if (color.a < 0.01) discard;
  gl_FragColor = color;
}`, { aPosition: pc.SEMANTIC_POSITION });
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.depthBias = 0;
  material.slopeDepthBias = 0;
  material.cull = pc.CULLFACE_NONE;
  // A drafting aid, not a material layer: keep enough contrast to build while
  // allowing authored albedo, grain, paint, and normal detail to read through.
  material.setParameter("uGridColor", [0.36, 0.4, 0.4, 0.2]);
  material.setParameter("uMajorColor", [0.66, 0.56, 0.38, 0.34]);
  material.setParameter("uGridCellSize", Math.max(.1, gridSize));
  material.setParameter("uGridLineWidth", .55);
  material.setParameter("uGridFadeDistance", 72);
  material.setParameter("uGridShape", shape === "hex" ? 1 : 0);
  material.setParameter("uCameraPosition", [cameraPosition.x, cameraPosition.y, cameraPosition.z]);
  material.update();
  return material;
};

export const createFogOfWarMaterial = (mask: pc.Texture): pc.ShaderMaterial => {
  const material = shader("fog-of-war", WORLD_VERTEX, `
precision highp float;
uniform sampler2D uFogMask;
uniform vec2 uMapMin;
uniform vec2 uMapMax;
uniform float uTime;
varying vec3 vWorldPos;

float hashNoise(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 value) {
  vec2 cell = floor(value);
  vec2 local = fract(value);
  local = local * local * (3.0 - 2.0 * local);
  return mix(mix(hashNoise(cell), hashNoise(cell + vec2(1.0, 0.0)), local.x), mix(hashNoise(cell + vec2(0.0, 1.0)), hashNoise(cell + vec2(1.0, 1.0)), local.x), local.y);
}

void main(void) {
  vec2 uv = (vWorldPos.xz - uMapMin) / (uMapMax - uMapMin);
  vec2 vision = texture2D(uFogMask, clamp(uv, 0.0, 1.0)).rg;
  float mist = valueNoise(vWorldPos.xz * 1.7 + vec2(uTime * .18, uTime * .09)) * .12 - .06;
  float visible = smoothstep(.35, .68, vision.r + mist);
  float explored = smoothstep(.28, .62, vision.g + mist * .45);
  vec3 unexplored = vec3(.008, .012, .024);
  vec3 exploredColor = vec3(.035, .045, .06);
  vec3 color = mix(unexplored, exploredColor, explored);
  float alpha = mix(.96, .62, explored);
  alpha = mix(alpha, 0.0, visible);
  if (alpha < .01) discard;
  gl_FragColor = vec4(color, alpha);
}`, { aPosition: pc.SEMANTIC_POSITION });
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.depthBias = 0;
  material.slopeDepthBias = 0;
  material.cull = pc.CULLFACE_NONE;
  material.setParameter("uFogMask", mask);
  material.setParameter("uTime", 0);
  material.update();
  return material;
};

export const createFlameMaterial = (base: [number, number, number], hot: [number, number, number]): pc.ShaderMaterial => {
  const material = shader("animated-flame", `
attribute vec3 aPosition;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
uniform float uTime;
varying vec3 vLocalPos;
varying float vFlicker;
void main(void) {
  vec3 position = aPosition;
  float height = clamp(position.y + .5, 0.0, 1.0);
  float slow = sin(uTime * 5.7 + position.y * 8.0);
  float fast = sin(uTime * 11.3 + position.y * 17.0 + position.z * 9.0);
  position.x += (slow * .075 + fast * .025) * height;
  position.z += cos(uTime * 7.1 + position.y * 13.0) * .045 * height;
  position.xz *= mix(1.12, .42, height);
  position.y *= 1.0 + .08 * sin(uTime * 8.4);
  vLocalPos = position;
  vFlicker = .86 + .14 * sin(uTime * 13.0 + position.y * 15.0);
  gl_Position = matrix_viewProjection * matrix_model * vec4(position, 1.0);
}`, `
precision highp float;
uniform vec3 uBaseColor;
uniform vec3 uHotColor;
uniform float uTime;
varying vec3 vLocalPos;
varying float vFlicker;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(void) {
  float height = clamp(vLocalPos.y + .5, 0.0, 1.0);
  float turbulence = hash(floor(vLocalPos.xz * 24.0 + uTime * 3.0));
  vec3 color = mix(uHotColor, uBaseColor, smoothstep(.08, .92, height));
  color *= vFlicker + turbulence * .16;
  float alpha = (1.0 - smoothstep(.62, 1.0, height)) * (.82 + turbulence * .18);
  gl_FragColor = vec4(color * 2.1, alpha);
}`, { aPosition: pc.SEMANTIC_POSITION });
  material.blendType = pc.BLEND_ADDITIVEALPHA;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.setParameter("uBaseColor", base);
  material.setParameter("uHotColor", hot);
  material.setParameter("uTime", 0);
  material.update();
  return material;
};

const waterNormalCache = new WeakMap<pc.GraphicsDevice, pc.Texture>();
const waterEnvironmentCache = new WeakMap<pc.GraphicsDevice, pc.Texture>();
const createWaterNormalTexture = (device: pc.GraphicsDevice): pc.Texture => {
  const cached = waterNormalCache.get(device);
  if (cached) return cached;
  const size = 128, canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d")!, image = context.createImageData(size, size);
  const height = (x: number, y: number) => Math.sin(x * .31 + Math.sin(y * .17) * 1.8) * .55 + Math.sin(y * .43 - x * .11) * .27 + Math.sin((x + y) * .73) * .08;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = height((x + 1) % size, y) - height((x - 1 + size) % size, y), dy = height(x, (y + 1) % size) - height(x, (y - 1 + size) % size);
    const normal = new pc.Vec3(-dx * .42, -dy * .42, 1).normalize(), index = (y * size + x) * 4;
    image.data[index] = Math.round((normal.x * .5 + .5) * 255); image.data[index + 1] = Math.round((normal.y * .5 + .5) * 255); image.data[index + 2] = Math.round((normal.z * .5 + .5) * 255); image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new pc.Texture(device, { name: "DnDRom dual-scroll water normal", width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
  texture.addressU = pc.ADDRESS_REPEAT; texture.addressV = pc.ADDRESS_REPEAT; texture.anisotropy = 8; texture.setSource(canvas); waterNormalCache.set(device, texture);
  return texture;
};

/** Lightweight local reflection probe used by streamed water. The six faces
 * model the Forge sky/ground environment without allocating a reflection
 * camera for every river chunk. */
const createWaterEnvironmentProbe = (device: pc.GraphicsDevice): pc.Texture => {
  const cached = waterEnvironmentCache.get(device);
  if (cached) return cached;
  const size = 64;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 0, size);
    const horizon = face === 2 ? "#a7b8be" : face === 3 ? "#28332d" : "#7f969d";
    const zenith = face === 2 ? "#d7e2e3" : face === 3 ? "#17221f" : "#526a73";
    gradient.addColorStop(0, zenith); gradient.addColorStop(.62, horizon); gradient.addColorStop(1, "#344b48");
    context.fillStyle = gradient; context.fillRect(0, 0, size, size);
    return canvas;
  });
  const texture = new pc.Texture(device, {
    name: "DnDRom streamed-water environment probe",
    width: size,
    height: size,
    cubemap: true,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
  });
  texture.setSource(faces);
  waterEnvironmentCache.set(device, texture);
  return texture;
};

/** Shared river/lake material: three Gerstner waves, dual-scrolling normals,
 * depth-buffer Beer attenuation, environment reflection,
 * downstream advection, and bank-distance foam. */
export const createFlowingWaterMaterial = (device: pc.GraphicsDevice): pc.ShaderMaterial => {
  const material = shader("world-flowing-water", `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv0;
attribute vec4 aColor;
uniform mat4 matrix_model;
uniform mat3 matrix_normal;
uniform mat4 matrix_viewProjection;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vEdge;
varying vec2 vFlow;
varying float vDepth;
varying vec4 vClipPosition;
void main(void) {
  vec4 world = matrix_model * vec4(aPosition, 1.0);
  vec2 flow = normalize(aColor.gb * 2.0 - 1.0 + vec2(.0001));
  float edgeGate = 1.0 - smoothstep(.45, 1.0, aColor.r);
  vec2 across = vec2(-flow.y, flow.x);
  vec2 diagonal = normalize(flow * .72 + across * .69);
  float phaseA = 1.9 * (dot(flow, world.xz) - uTime * 1.15);
  float phaseB = 3.1 * (dot(across, world.xz) - uTime * .48);
  float phaseC = 4.7 * (dot(diagonal, world.xz) - uTime * .31);
  // The generated channel bed guarantees roughly 6.5 cm clearance. Keep the
  // combined displacement below that clearance so troughs never expose the
  // terrain as holes through a stream or lake.
  float amplitudeA = .021, amplitudeB = .009, amplitudeC = .004;
  float steepA = .34, steepB = .2, steepC = .14;
  world.xz += edgeGate * (flow * steepA * amplitudeA * cos(phaseA) + across * steepB * amplitudeB * cos(phaseB) + diagonal * steepC * amplitudeC * cos(phaseC));
  world.y += edgeGate * (amplitudeA * sin(phaseA) + amplitudeB * sin(phaseB) + amplitudeC * sin(phaseC));
  vec2 slope = edgeGate * (flow * 1.9 * amplitudeA * cos(phaseA) + across * 3.1 * amplitudeB * cos(phaseB) + diagonal * 4.7 * amplitudeC * cos(phaseC));
  vWorldPos = world.xyz;
  vNormal = normalize(matrix_normal * normalize(vec3(-slope.x, 1.0, -slope.y)));
  vUv = aUv0;
  vEdge = aColor.r;
  vFlow = flow;
  vDepth = max(.04, aColor.a * 3.2);
  vClipPosition = matrix_viewProjection * world;
  gl_Position = vClipPosition;
}`, `
precision highp float;
uniform float uTime;
uniform vec3 view_position;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform sampler2D uSceneDepthMap;
uniform sampler2D uSceneColorMap;
uniform sampler2D uWaterNormal;
uniform samplerCube uWaterEnvironment;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
varying float vEdge;
varying vec2 vFlow;
varying float vDepth;
varying vec4 vClipPosition;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(void) {
  vec2 across = vec2(-vFlow.y, vFlow.x);
  float along = dot(vWorldPos.xz, vFlow);
  float crossFlow = dot(vWorldPos.xz, across);
  float phaseA = along * .62 - uTime * 1.08 + sin(crossFlow * .27) * .38;
  float phaseB = crossFlow * .78 + uTime * .54 + sin(along * .19);
  vec3 normalDetail = normalize(vec3(cos(phaseA) * .032 + sin(phaseB) * .012, 1.0, sin(phaseA * .81) * .026 + cos(phaseB) * .01));
  vec3 normalA = texture2D(uWaterNormal, vWorldPos.xz * .075 + vFlow * uTime * .018).xyz * 2.0 - 1.0;
  vec3 normalB = texture2D(uWaterNormal, vWorldPos.xz * .123 + across * uTime * -.011).xyz * 2.0 - 1.0;
  // Fine normals break up the highlight without replacing the broad surface
  // normal. Letting the normal tile dominate makes water read as white foil.
  vec3 scrollingNormal = normalize(vec3((normalA.x + normalB.y) * .28, 4.2, (normalA.y - normalB.x) * .28));
  vec3 N = normalize(mix(mix(vNormal, normalDetail, .16), scrollingNormal, .1));
  vec3 V = normalize(view_position - vWorldPos);
  vec3 L = normalize(-uSunDirection);
  vec3 H = normalize(V + L);
  float fresnel = .02 + .56 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float current = .5 + .5 * sin(phaseA * .55 + phaseB * .21);
  float currentBand = .5 + .5 * sin(phaseA + sin(phaseB) * .24);
  vec2 screenUv = vClipPosition.xy / max(.0001, vClipPosition.w) * .5 + .5;
  float sceneDepth = texture2D(uSceneDepthMap, screenUv).r;
  float screenDepthDelta = clamp(abs(sceneDepth - gl_FragCoord.z) * 36.0, 0.0, 2.0);
  float opticalDepth = max(vDepth, screenDepthDelta);
  vec2 refractionOffset = (normalA.xz + normalB.zx) * .0035 * smoothstep(.04, .8, opticalDepth) * (1.0 - vEdge * .72);
  vec3 refractedScene = texture2D(uSceneColorMap, clamp(screenUv + refractionOffset, vec2(.002), vec2(.998))).rgb;
  vec3 absorption = exp(-vec3(1.28, .42, .2) * opticalDepth);
  vec3 body = mix(uDeepColor, uShallowColor, clamp(exp(-opticalDepth * .78) + current * .06, 0.0, 1.0));
  float daylight = .62 + max(dot(N, L), 0.0) * .38;
  vec3 reflectedSky = textureCube(uWaterEnvironment, reflect(-V, N)).rgb;
  vec3 transmitted = body * mix(vec3(.72), absorption, .18);
  vec3 reflected = reflectedSky * .065 + body * .935;
  vec3 color = mix(transmitted, reflected, fresnel) * daylight + vec3(.003, .022, .03) * currentBand;
  // Refraction is a detail, not the base color. Letting the captured terrain
  // dominate made green banks plus the scene grade read as opaque lavender.
  color = mix(refractedScene * mix(vec3(.72, .86, .84), body, .28), color, .88);
  color = mix(color, body * (.72 + daylight * .28), .34);
  color += uSunColor * pow(max(dot(N, H), 0.0), 128.0) * .12;
  float foamNoise = .5 + .5 * sin(along * 2.35 - uTime * 2.2 + sin(crossFlow * .42) + hash(floor(vWorldPos.xz * 1.2)) * 2.4);
  float shoreBand = smoothstep(.72, .985, vEdge);
  float breaker = smoothstep(.42, .82, foamNoise);
  float foam = shoreBand * (.3 + breaker * .7);
  foam *= .72 + max(dot(N, L), 0.0) * .28;
  color = mix(color, vec3(.68, .78, .73), foam * ${WORLD_VISUAL_CONFIG.water.foamStrength.toFixed(2)});
  float alpha = mix(${WORLD_VISUAL_CONFIG.water.deepAlpha.toFixed(2)}, ${WORLD_VISUAL_CONFIG.water.shallowAlpha.toFixed(2)}, clamp(exp(-opticalDepth * .72), 0.0, 1.0));
  alpha = clamp(alpha + fresnel * .1 + foam * .12, .52, .91);
  gl_FragColor = vec4(color, alpha);
}`, { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL, aUv0: pc.SEMANTIC_TEXCOORD0, aColor: pc.SEMANTIC_COLOR });
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.setParameter("uTime", 0);
  material.setParameter("uShallowColor", WORLD_VISUAL_CONFIG.water.shallowColor);
  material.setParameter("uDeepColor", WORLD_VISUAL_CONFIG.water.deepColor);
  material.setParameter("uSunDirection", [.35, -.84, .4]);
  material.setParameter("uSunColor", [1, .92, .72]);
  material.setParameter("uWaterNormal", createWaterNormalTexture(device));
  material.setParameter("uWaterEnvironment", createWaterEnvironmentProbe(device));
  material.update();
  return material;
};

/** Chunk-batched tapered grass using StandardMaterial's forward and shadow
 * passes. Only the vertex transform is replaced: roots remain fixed, tips
 * bend, and the identical deformation is used while rendering shadow maps. */
export const createWindGrassMaterial = (base: [number, number, number]): pc.StandardMaterial => {
  const material = new pc.StandardMaterial();
  material.name = "world-wind-grass-pbr";
  material.diffuse = new pc.Color(base[0], base[1], base[2]);
  material.diffuseVertexColor = true;
  material.useLighting = true;
  material.useSkybox = true;
  material.useMetalness = true;
  material.metalness = 0;
  material.gloss = .035;
  material.specularityFactor = .08;
  material.clearCoat = 0;
  material.cull = pc.CULLFACE_NONE;
  material.twoSidedLighting = true;
  material.alphaToCoverage = true;
  material.shaderChunksVersion = "2.21";
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("transformVS", `
#ifdef PIXELSNAP
uniform vec4 uScreenSize;
#endif
#ifdef SCREENSPACE
uniform float projectionFlipY;
#endif
uniform float uTime;
uniform vec2 uWorldWind;
uniform vec3 uPlayerPosition;
uniform float uBendRadius;
uniform float uBendStrength;
uniform vec3 uGrassViewPosition;
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
  vec3 localPos = getLocalPosition(vertexPosition);
  float rootLocked = smoothstep(.025, .28, localPos.y);
  float weight = rootLocked * rootLocked;
  vec4 unbentWorld = modelMatrix * vec4(localPos, 1.0);
  float phase = fract(sin(dot(unbentWorld.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  float gustEnvelope = .55 + .45 * sin(uTime * .31 + unbentWorld.x * .027 - unbentWorld.z * .019);
  float gust = sin(uTime * 1.45 + unbentWorld.x * .19 + unbentWorld.z * .13 + phase) * gustEnvelope;
  float detail = sin(uTime * 3.8 + unbentWorld.x * .71 - unbentWorld.z * .53 + phase * 1.7);
  localPos.x += (gust * .16 + detail * .035) * weight * uWorldWind.x;
  localPos.z += (gust * .09 - detail * .025) * weight * uWorldWind.y;
  vec4 world = modelMatrix * vec4(localPos, 1.0);
  vec2 away = world.xz - uPlayerPosition.xz;
  float playerDistance = length(away);
  float interaction = 1.0 - smoothstep(0.0, uBendRadius, playerDistance);
  away = playerDistance > .001 ? away / playerDistance : vec2(1.0, 0.0);
  localPos.xz += away * interaction * uBendStrength * weight;
  localPos.y -= interaction * uBendStrength * .32 * weight;
  localPos.y *= 1.0 - smoothstep(35.0, 70.0, length(unbentWorld.xyz - uGrassViewPosition));
  return modelMatrix * vec4(localPos, 1.0);
}
vec4 getPosition() {
  dModelMatrix = getModelMatrix();
  vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
  dPositionW = posW.xyz;
  vec4 screenPos;
  #ifdef UV1LAYOUT
    screenPos = vec4(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1.0);
    #ifdef WEBGPU
      screenPos.y *= -1.0;
    #endif
  #else
    #ifdef SCREENSPACE
      screenPos = posW;
      screenPos.y *= projectionFlipY;
    #else
      screenPos = matrix_viewProjection * posW;
    #endif
    #ifdef PIXELSNAP
      screenPos.xy = (screenPos.xy * 0.5) + 0.5;
      screenPos.xy *= uScreenSize.xy;
      screenPos.xy = floor(screenPos.xy);
      screenPos.xy *= uScreenSize.zw;
      screenPos.xy = (screenPos.xy * 2.0) - 1.0;
    #endif
  #endif
  return screenPos;
}
vec3 getWorldPosition() { return dPositionW; }
`);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("transformVS", `
#ifdef PIXELSNAP
  uniform uScreenSize: vec4f;
#endif
#ifdef SCREENSPACE
  uniform projectionFlipY: f32;
#endif
uniform uTime: f32;
uniform uWorldWind: vec2f;
uniform uPlayerPosition: vec3f;
uniform uBendRadius: f32;
uniform uBendStrength: f32;
uniform uGrassViewPosition: vec3f;
fn evalWorldPosition(vertexPosition: vec3f, modelMatrix: mat4x4f) -> vec4f {
  var localPos: vec3f = getLocalPosition(vertexPosition);
  let rootLocked: f32 = smoothstep(.025, .28, localPos.y);
  let weight: f32 = rootLocked * rootLocked;
  let unbentWorld: vec4f = modelMatrix * vec4f(localPos, 1.0);
  let phase: f32 = fract(sin(dot(unbentWorld.xz, vec2f(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  let gustEnvelope: f32 = .55 + .45 * sin(uniform.uTime * .31 + unbentWorld.x * .027 - unbentWorld.z * .019);
  let gust: f32 = sin(uniform.uTime * 1.45 + unbentWorld.x * .19 + unbentWorld.z * .13 + phase) * gustEnvelope;
  let detail: f32 = sin(uniform.uTime * 3.8 + unbentWorld.x * .71 - unbentWorld.z * .53 + phase * 1.7);
  localPos.x += (gust * .16 + detail * .035) * weight * uniform.uWorldWind.x;
  localPos.z += (gust * .09 - detail * .025) * weight * uniform.uWorldWind.y;
  var world: vec4f = modelMatrix * vec4f(localPos, 1.0);
  var away: vec2f = world.xz - uniform.uPlayerPosition.xz;
  let playerDistance: f32 = length(away);
  let interaction: f32 = 1.0 - smoothstep(0.0, uniform.uBendRadius, playerDistance);
  away = select(vec2f(1.0, 0.0), away / playerDistance, playerDistance > .001);
  let playerBend: vec2f = away * interaction * uniform.uBendStrength * weight;
  localPos.x += playerBend.x;
  localPos.z += playerBend.y;
  localPos.y -= interaction * uniform.uBendStrength * .32 * weight;
  localPos.y *= 1.0 - smoothstep(35.0, 70.0, length(unbentWorld.xyz - uniform.uGrassViewPosition));
  return modelMatrix * vec4f(localPos, 1.0);
}
fn getPosition() -> vec4f {
  dModelMatrix = getModelMatrix();
  let posW: vec4f = evalWorldPosition(vertex_position.xyz, dModelMatrix);
  dPositionW = posW.xyz;
  var screenPos: vec4f;
  #ifdef UV1LAYOUT
    screenPos = vec4f(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1.0);
    screenPos.y *= -1.0;
  #else
    #ifdef SCREENSPACE
      screenPos = posW;
      screenPos.y *= uniform.projectionFlipY;
    #else
      screenPos = uniform.matrix_viewProjection * posW;
    #endif
    #ifdef PIXELSNAP
      screenPos.xy = (screenPos.xy * 0.5) + 0.5;
      screenPos.xy *= uniform.uScreenSize.xy;
      screenPos.xy = floor(screenPos.xy);
      screenPos.xy *= uniform.uScreenSize.zw;
      screenPos.xy = (screenPos.xy * 2.0) - 1.0;
    #endif
  #endif
  return screenPos;
}
fn getWorldPosition() -> vec3f { return dPositionW; }
`);
  material.setParameter("uTime", 0);
  material.setParameter("uWorldWind", [1,1]);
  material.setParameter("uPlayerPosition", [100000, 100000, 100000]);
  material.setParameter("uBendRadius", 1.35);
  material.setParameter("uBendStrength", .7);
  material.setParameter("uGrassViewPosition", [0,0,0]);
  material.update();
  return material;
};

interface TerrainLayerTextures {
  grass: pc.Texture;
  dirt: pc.Texture;
  sand: pc.Texture;
  rock: pc.Texture;
  snow: pc.Texture;
  road: pc.Texture;
  grassNormal: pc.Texture;
  dirtNormal: pc.Texture;
  sandNormal: pc.Texture;
  rockNormal: pc.Texture;
  snowNormal: pc.Texture;
  roadNormal: pc.Texture;
  normalAtlas: pc.Texture;
}
const terrainLayerCache = new WeakMap<pc.GraphicsDevice, TerrainLayerTextures>();

const createTerrainLayerTextures = (device: pc.GraphicsDevice): TerrainLayerTextures => {
  const size = 128;
  const hash = (x: number, y: number, salt: number) => {
    let value = Math.imul((x + salt) | 0, 374761393) ^ Math.imul((y - salt) | 0, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
  };
  const make = (name: string, base: [number, number, number], seed: number, striation = false) => {
    const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d")!, image = context.createImageData(size, size);
    const noise = (x: number, y: number, cells: number, salt: number) => {
      const px = x / size * cells, py = y / size * cells, x0 = Math.floor(px), y0 = Math.floor(py);
      const localX = px - x0, localY = py - y0, tx = localX * localX * (3 - 2 * localX), ty = localY * localY * (3 - 2 * localY);
      const sample = (dx: number, dy: number) => hash((x0 + dx + cells) % cells, (y0 + dy + cells) % cells, salt);
      const low = sample(0, 0) + (sample(1, 0) - sample(0, 0)) * tx;
      const high = sample(0, 1) + (sample(1, 1) - sample(0, 1)) * tx;
      return low + (high - low) * ty;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const broad = noise(x, y, 4, seed), detail = noise(x, y, 13, seed + 53), grain = hash(x, y, seed + 109);
      const bands = striation ? (noise(x, y + (broad - .5) * 18, 19, seed + 211) - .5) * .22 : 0;
      const variation = .76 + broad * .2 + (detail - .5) * .14 + (grain - .5) * .08 + bands;
      const index = (y * size + x) * 4;
      image.data[index] = Math.max(0, Math.min(255, base[0] * variation));
      image.data[index + 1] = Math.max(0, Math.min(255, base[1] * variation));
      image.data[index + 2] = Math.max(0, Math.min(255, base[2] * variation));
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const texture = new pc.Texture(device, { name: `world-terrain-${name}`, width: size, height: size, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
    texture.addressU = pc.ADDRESS_REPEAT; texture.addressV = pc.ADDRESS_REPEAT; texture.anisotropy = 8; texture.setSource(canvas);
    return texture;
  };
  const makeNormalCanvas = (seed: number, profile: "grass" | "dirt" | "rock" | "snow" | "sand") => {
    const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d")!, image = context.createImageData(size, size);
    const mineralNoise=(x:number,y:number,cells:number)=>{
      const px=x/size*cells,py=y/size*cells,ix=Math.floor(px),iy=Math.floor(py);
      const u=px-ix,v=py-iy,tx=u*u*(3-2*u),ty=v*v*(3-2*v);
      const at=(dx:number,dy:number)=>hash(((ix+dx)%cells+cells)%cells,((iy+dy)%cells+cells)%cells,seed+cells);
      return (at(0,0)*(1-tx)+at(1,0)*tx)*(1-ty)+(at(0,1)*(1-tx)+at(1,1)*tx)*ty;
    };
    const height = (sourceX: number, sourceY: number) => {
      const x = (sourceX + size) % size, y = (sourceY + size) % size;
      const grain = hash(x, y, seed), broad = hash(Math.floor(x / 6), Math.floor(y / 6), seed + 47);
      if (profile === "grass") return Math.sin((x + Math.sin(y * .19) * 2.4) * .82) * .16 + Math.sin(y * .24) * .05 + (grain - .5) * .08;
      if (profile === "dirt") return (broad - .5) * .34 + (grain - .5) * .28 + (grain > .91 ? .38 : 0);
      if (profile === "sand") return Math.sin((x + Math.sin(y * .052) * 10) * .19) * .11 + Math.sin((x + y * .2) * .055) * .035 + (grain - .5) * .018;
      if (profile === "rock") return Math.abs(mineralNoise(x,y,5)-.5)*.9 + mineralNoise(x,y,17)*.32 + (grain-.5)*.08;
      return (broad - .5) * .05 + (grain - .5) * .025;
    };
    const strength = profile === "dirt" ? 2.1 : profile === "sand" ? 1.18 : profile === "grass" ? 1.45 : profile === "rock" ? 2.5 : .32;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * strength;
      const dy = (height(x, y + 1) - height(x, y - 1)) * strength;
      const length = Math.max(.0001, Math.hypot(dx, dy, 1)), index = (y * size + x) * 4;
      image.data[index] = Math.round((-dx / length * .5 + .5) * 255);
      image.data[index + 1] = Math.round((-dy / length * .5 + .5) * 255);
      image.data[index + 2] = Math.round((1 / length * .5 + .5) * 255);
      image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  };
  const makeNormal = (name: string, seed: number, profile: "grass" | "dirt" | "rock" | "snow" | "sand") => {
    const canvas = makeNormalCanvas(seed, profile);
    const texture = new pc.Texture(device, { name: `world-terrain-${name}-normal`, width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
    texture.addressU = pc.ADDRESS_REPEAT; texture.addressV = pc.ADDRESS_REPEAT; texture.anisotropy = 8; texture.setSource(canvas);
    return texture;
  };
  // One atlas keeps five independent surface responses within WebGPU's
  // fragment binding budget after environment and shadow textures are added.
  // Tile order: grass, dirt, sand, rock, snow, road.
  const normalAtlasCanvas = document.createElement("canvas");
  normalAtlasCanvas.width = size * 6; normalAtlasCanvas.height = size;
  const normalAtlasContext = normalAtlasCanvas.getContext("2d")!;
  const normalProfiles: [number, "grass" | "dirt" | "rock" | "snow" | "sand"][] = [
    [211, "grass"], [307, "dirt"], [353, "sand"], [401, "rock"], [503, "snow"], [607, "dirt"],
  ];
  normalProfiles.forEach(([seed, profile], index) => normalAtlasContext.drawImage(makeNormalCanvas(seed, profile), index * size, 0));
  const normalAtlas = new pc.Texture(device, { name: "world-terrain-surface-normal-atlas", width: size * 6, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
  normalAtlas.addressU = pc.ADDRESS_CLAMP_TO_EDGE; normalAtlas.addressV = pc.ADDRESS_REPEAT; normalAtlas.anisotropy = 8; normalAtlas.setSource(normalAtlasCanvas);
  return {
    grass: make("grass", [82, 113, 65], 19), dirt: make("dirt", [112, 82, 51], 43), sand: make("sand", [194, 151, 88], 59, true),
    rock: make("rock", [113, 114, 108], 71, true), snow: make("snow", [210, 218, 220], 101), road: make("road", [108, 76, 45], 137, true),
    grassNormal: makeNormal("grass", 211, "grass"), dirtNormal: makeNormal("dirt", 307, "dirt"), sandNormal: makeNormal("sand", 353, "sand"),
    rockNormal: makeNormal("rock", 401, "rock"), snowNormal: makeNormal("snow", 503, "snow"), roadNormal: makeNormal("road", 607, "dirt"),
    normalAtlas,
  };
};

/** PBR terrain with true world-space triplanar projection, normal/slope blend,
 * height blend, and an alpha-carried road weight. */
export const configureWorldTerrainMaterial = (material: pc.StandardMaterial, device: pc.GraphicsDevice, biomeId = "forest"): void => {
  let layers = terrainLayerCache.get(device);
  if (!layers) { layers = createTerrainLayerTextures(device); terrainLayerCache.set(device, layers); }
  material.diffuseMap = null;
  // `materialFor` starts with a generic five-map PBR surface. Terrain owns a
  // purpose-built texture set, so retaining those bindings wastes samplers and
  // can exceed WebGPU's per-stage limit even though their shader paths are no
  // longer authoritative.
  material.normalMap = null;
  material.normalDetailMap = null;
  material.aoMap = null;
  material.aoDetailMap = null;
  material.glossMap = null;
  material.metalnessMap = null;
  material.heightMap = null;
  material.diffuse = new pc.Color(1, 1, 1);
  material.diffuseVertexColor = true;
  material.gloss = .04;
  material.metalness = 0;
  material.bumpiness = 1;
  material.clearCoat = 0;
  material.clearCoatGloss = 0;
  material.specularityFactor = .09;
  material.specular = new pc.Color(.08, .08, .08);
  const desert = biomeId === "desert";
  material.setParameter("uTerrainGrass", desert ? layers.sand : layers.grass);
  material.setParameter("uTerrainDirt", biomeId === "desert" ? layers.sand : layers.dirt);
  material.setParameter("uTerrainRock", desert ? layers.dirt : layers.rock);
  material.setParameter("uTerrainSnow", layers.snow);
  material.setParameter("uTerrainRoad", layers.road);
  material.setParameter("uTerrainGrassNormal", layers.grassNormal);
  material.setParameter("uTerrainDirtNormal", biomeId === "desert" ? layers.sandNormal : layers.dirtNormal);
  material.setParameter("uTerrainRockNormal", layers.rockNormal);
  material.setParameter("uTerrainSnowNormal", layers.snowNormal);
  material.setParameter("uTerrainRoadNormal", layers.roadNormal);
  material.setParameter("uTerrainNormalAtlas", layers.normalAtlas);
  material.shaderChunksVersion = "2.21";
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("diffusePS", `
uniform vec3 material_diffuse;
uniform vec4 uWorldSurfaceWeather;
uniform sampler2D uTerrainGrass;
uniform sampler2D uTerrainDirt;
uniform sampler2D uTerrainRock;
uniform sampler2D uTerrainSnow;
uniform sampler2D uTerrainRoad;
vec3 dndromTriplanar(sampler2D source, vec3 world, vec3 weights, float scale) {
  vec3 x = texture2D(source, world.zy * scale).rgb;
  vec3 y = texture2D(source, world.xz * scale).rgb;
  vec3 z = texture2D(source, world.xy * scale).rgb;
  return x * weights.x + y * weights.y + z * weights.z;
}
float dndromTerrainHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
}
float dndromTerrainNoise(vec2 world, float scale) {
  vec2 point = world * scale;
  vec2 cell = floor(point), local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = dndromTerrainHash(cell);
  float b = dndromTerrainHash(cell + vec2(1.0, 0.0));
  float c = dndromTerrainHash(cell + vec2(0.0, 1.0));
  float d = dndromTerrainHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}
void getAlbedo() {
  vec3 normal = normalize(dVertexNormalW);
  vec3 weights = pow(abs(normal), vec3(5.0));
  weights /= max(dot(weights, vec3(1.0)), .0001);
  float up = clamp(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
  float cliff = 1.0 - smoothstep(.48, .76, up);
  float highland = max(uWorldSurfaceWeather.y, smoothstep(uWorldSurfaceWeather.z, uWorldSurfaceWeather.z + 90.0, vPositionW.y));
  vec3 grass = dndromTriplanar(uTerrainGrass, vPositionW, weights, .19);
  vec3 dirt = dndromTriplanar(uTerrainDirt, vPositionW, weights, .23);
  vec3 rock = mix(dndromTriplanar(uTerrainRock, vPositionW, weights, .017), dndromTriplanar(uTerrainRock, vPositionW, weights, .16), .38);
  vec3 snow = dndromTriplanar(uTerrainSnow, vPositionW, weights, .21);
  vec3 road = dndromTriplanar(uTerrainRoad, vPositionW, weights, .27);
  float fieldRock = saturate(max(vVertexColor.r, cliff));
  float fieldGrass = saturate(vVertexColor.g * smoothstep(.42, .82, up));
  float fieldWet = saturate(vVertexColor.b * (1.0 - fieldRock));
  float fieldSoil = max(0.0, 1.0 - fieldRock - fieldGrass * .82 - fieldWet * .72);
  float fieldTotal = max(.0001, fieldRock + fieldGrass + fieldWet + fieldSoil);
  fieldRock /= fieldTotal; fieldGrass /= fieldTotal; fieldWet /= fieldTotal; fieldSoil /= fieldTotal;
  vec3 wetSoil = dirt * vec3(.48, .62, .5);
  vec3 natural = rock * fieldRock + grass * fieldGrass + wetSoil * fieldWet + dirt * fieldSoil;
  float macroA = dndromTerrainNoise(vPositionW.xz, .052);
  float macroB = dndromTerrainNoise(vPositionW.xz + vec2(41.7, -19.3), .019);
  float macroVariation = .84 + macroA * .17 + macroB * .11;
  natural *= macroVariation;
  natural *= 1.0 - uWorldSurfaceWeather.x * .32 * up;
  natural *= mix(vec3(.91, .96, .86), vec3(1.06, .96, .88), macroB * .45);
  natural = mix(natural, snow, highland * smoothstep(.68, .94, up));
  float roadWeight = saturate(vVertexColor.a);
  dAlbedo = material_diffuse.rgb * mix(natural, road, roadWeight);
}
`);
  // WGSL cannot portably pass texture/sampler handles through a helper as the
  // GLSL implementation does. Keep every triplanar tap explicit so WebGPU uses
  // native WGSL instead of PlayCanvas' compatibility transpiler.
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("diffusePS", `
uniform material_diffuse: vec3f;
uniform uWorldSurfaceWeather: vec4f;
var uTerrainGrass: texture_2d<f32>;
var uTerrainGrassSampler: sampler;
var uTerrainDirt: texture_2d<f32>;
var uTerrainDirtSampler: sampler;
var uTerrainRock: texture_2d<f32>;
var uTerrainRockSampler: sampler;
var uTerrainSnow: texture_2d<f32>;
var uTerrainSnowSampler: sampler;
var uTerrainRoad: texture_2d<f32>;
var uTerrainRoadSampler: sampler;
fn dndromTerrainHash(cell: vec2f) -> f32 {
  return fract(sin(dot(cell, vec2f(127.1, 311.7))) * 43758.5453123);
}
fn dndromTerrainNoise(world: vec2f, scale: f32) -> f32 {
  let point: vec2f = world * scale;
  let cell: vec2f = floor(point);
  var local: vec2f = fract(point);
  local = local * local * (vec2f(3.0) - 2.0 * local);
  let a: f32 = dndromTerrainHash(cell);
  let b: f32 = dndromTerrainHash(cell + vec2f(1.0, 0.0));
  let c: f32 = dndromTerrainHash(cell + vec2f(0.0, 1.0));
  let d: f32 = dndromTerrainHash(cell + vec2f(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}
fn getAlbedo() {
  let normal: vec3f = normalize(dVertexNormalW);
  var weights: vec3f = pow(abs(normal), vec3f(5.0));
  weights /= max(dot(weights, vec3f(1.0)), .0001);
  let up: f32 = clamp(dot(normal, vec3f(0.0, 1.0, 0.0)), 0.0, 1.0);
  let cliff: f32 = 1.0 - smoothstep(.48, .76, up);
  let highland: f32 = max(uniform.uWorldSurfaceWeather.y, smoothstep(uniform.uWorldSurfaceWeather.z, uniform.uWorldSurfaceWeather.z + 90.0, vPositionW.y));
  let grass: vec3f = textureSample(uTerrainGrass, uTerrainGrassSampler, vPositionW.zy * .19).rgb * weights.x
    + textureSample(uTerrainGrass, uTerrainGrassSampler, vPositionW.xz * .19).rgb * weights.y
    + textureSample(uTerrainGrass, uTerrainGrassSampler, vPositionW.xy * .19).rgb * weights.z;
  let dirt: vec3f = textureSample(uTerrainDirt, uTerrainDirtSampler, vPositionW.zy * .23).rgb * weights.x
    + textureSample(uTerrainDirt, uTerrainDirtSampler, vPositionW.xz * .23).rgb * weights.y
    + textureSample(uTerrainDirt, uTerrainDirtSampler, vPositionW.xy * .23).rgb * weights.z;
  let rockFine: vec3f = textureSample(uTerrainRock, uTerrainRockSampler, vPositionW.zy * .16).rgb * weights.x
    + textureSample(uTerrainRock, uTerrainRockSampler, vPositionW.xz * .16).rgb * weights.y
    + textureSample(uTerrainRock, uTerrainRockSampler, vPositionW.xy * .16).rgb * weights.z;
  let rockMacro: vec3f = textureSample(uTerrainRock, uTerrainRockSampler, vPositionW.zy * .017).rgb * weights.x
    + textureSample(uTerrainRock, uTerrainRockSampler, vPositionW.xz * .017).rgb * weights.y
    + textureSample(uTerrainRock, uTerrainRockSampler, vPositionW.xy * .017).rgb * weights.z;
  let rock: vec3f = mix(rockMacro, rockFine, .38);
  let snow: vec3f = textureSample(uTerrainSnow, uTerrainSnowSampler, vPositionW.zy * .21).rgb * weights.x
    + textureSample(uTerrainSnow, uTerrainSnowSampler, vPositionW.xz * .21).rgb * weights.y
    + textureSample(uTerrainSnow, uTerrainSnowSampler, vPositionW.xy * .21).rgb * weights.z;
  let road: vec3f = textureSample(uTerrainRoad, uTerrainRoadSampler, vPositionW.zy * .27).rgb * weights.x
    + textureSample(uTerrainRoad, uTerrainRoadSampler, vPositionW.xz * .27).rgb * weights.y
    + textureSample(uTerrainRoad, uTerrainRoadSampler, vPositionW.xy * .27).rgb * weights.z;
  var fieldRock: f32 = saturate(max(vVertexColor.r, cliff));
  var fieldGrass: f32 = saturate(vVertexColor.g * smoothstep(.42, .82, up));
  var fieldWet: f32 = saturate(vVertexColor.b * (1.0 - fieldRock));
  var fieldSoil: f32 = max(0.0, 1.0 - fieldRock - fieldGrass * .82 - fieldWet * .72);
  let fieldTotal: f32 = max(.0001, fieldRock + fieldGrass + fieldWet + fieldSoil);
  fieldRock /= fieldTotal; fieldGrass /= fieldTotal; fieldWet /= fieldTotal; fieldSoil /= fieldTotal;
  let wetSoil: vec3f = dirt * vec3f(.48, .62, .5);
  var natural: vec3f = rock * fieldRock + grass * fieldGrass + wetSoil * fieldWet + dirt * fieldSoil;
  let macroA: f32 = dndromTerrainNoise(vPositionW.xz, .052);
  let macroB: f32 = dndromTerrainNoise(vPositionW.xz + vec2f(41.7, -19.3), .019);
  let macroVariation: f32 = .84 + macroA * .17 + macroB * .11;
  natural *= macroVariation;
  natural *= 1.0 - uniform.uWorldSurfaceWeather.x * .32 * up;
  natural *= mix(vec3f(.91, .96, .86), vec3f(1.06, .96, .88), macroB * .45);
  natural = mix(natural, snow, highland * smoothstep(.68, .94, up));
  let roadWeight: f32 = saturate(vVertexColor.a);
  dAlbedo = uniform.material_diffuse.rgb * mix(natural, road, roadWeight);
}
`);
  const grassNormalTile = desert ? 2 : 0;
  const dirtNormalTile = desert ? 2 : 1;
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("normalMapPS", `
uniform sampler2D uTerrainNormalAtlas;
vec3 dndromAtlasNormal(float tile, vec2 worldUv, float scale) {
  vec2 localUv = clamp(fract(worldUv * scale), vec2(.004), vec2(.996));
  vec2 atlasUv = vec2((tile + localUv.x) / 6.0, localUv.y);
  return texture2D(uTerrainNormalAtlas, atlasUv).xyz * 2.0 - 1.0;
}
void getNormal() {
  vec3 geometric = normalize(dVertexNormalW);
  float up = clamp(dot(geometric, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
  float rock = max(saturate(vVertexColor.r), 1.0 - smoothstep(.48, .76, up));
  float road = saturate(vVertexColor.a);
  float grass = saturate(vVertexColor.g) * smoothstep(.42, .82, up) * (1.0 - rock) * (1.0 - road);
  float soil = max(0.0, 1.0 - rock - grass - road);
  vec3 detail = dndromAtlasNormal(${grassNormalTile.toFixed(1)}, vPositionW.xz, .19) * grass
    + dndromAtlasNormal(${dirtNormalTile.toFixed(1)}, vPositionW.xz, .23) * soil
    + dndromAtlasNormal(3.0, vPositionW.xz, .16) * rock
    + dndromAtlasNormal(5.0, vPositionW.xz, .27) * road;
  detail = normalize(detail + vec3(0.0, 0.0, .0001));
  vec3 reference = abs(geometric.y) > .985 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(reference, geometric));
  vec3 bitangent = normalize(cross(geometric, tangent));
  vec3 mapped = normalize(tangent * detail.x + bitangent * detail.y + geometric * max(.22, detail.z));
  dNormalW = normalize(mix(geometric, mapped, .58 * (1.0 - smoothstep(.2, 2.0, max(length(dFdx(vPositionW)), length(dFdy(vPositionW)))))));
}`);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("normalMapPS", `
var uTerrainNormalAtlas: texture_2d<f32>;
var uTerrainNormalAtlasSampler: sampler;
fn dndromAtlasNormal(tile: f32, worldUv: vec2f, scale: f32) -> vec3f {
  let localUv: vec2f = clamp(fract(worldUv * scale), vec2f(.004), vec2f(.996));
  let atlasUv: vec2f = vec2f((tile + localUv.x) / 6.0, localUv.y);
  return textureSample(uTerrainNormalAtlas, uTerrainNormalAtlasSampler, atlasUv).xyz * 2.0 - 1.0;
}
fn getNormal() {
  let geometric: vec3f = normalize(dVertexNormalW);
  let up: f32 = clamp(dot(geometric, vec3f(0.0, 1.0, 0.0)), 0.0, 1.0);
  let rock: f32 = max(saturate(vVertexColor.r), 1.0 - smoothstep(.48, .76, up));
  let road: f32 = saturate(vVertexColor.a);
  let grass: f32 = saturate(vVertexColor.g) * smoothstep(.42, .82, up) * (1.0 - rock) * (1.0 - road);
  let soil: f32 = max(0.0, 1.0 - rock - grass - road);
  var detail: vec3f = dndromAtlasNormal(${grassNormalTile.toFixed(1)}, vPositionW.xz, .19) * grass
    + dndromAtlasNormal(${dirtNormalTile.toFixed(1)}, vPositionW.xz, .23) * soil
    + dndromAtlasNormal(3.0, vPositionW.xz, .16) * rock
    + dndromAtlasNormal(5.0, vPositionW.xz, .27) * road;
  detail = normalize(detail + vec3f(0.0, 0.0, .0001));
  let reference: vec3f = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(geometric.y) > .985);
  let tangent: vec3f = normalize(cross(reference, geometric));
  let bitangent: vec3f = normalize(cross(geometric, tangent));
  let mapped: vec3f = normalize(tangent * detail.x + bitangent * detail.y + geometric * max(.22, detail.z));
  dNormalW = normalize(mix(geometric, mapped, .58 * (1.0 - smoothstep(.2, 2.0, max(length(dpdx(vPositionW)), length(dpdy(vPositionW)))))));
}`);
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("glossPS", `
void getGlossiness() {
  vec3 normal = normalize(dVertexNormalW);
  float up = clamp(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
  float rock = max(saturate(vVertexColor.r), 1.0 - smoothstep(.48, .76, up));
  float road = saturate(vVertexColor.a);
  float grass = saturate(vVertexColor.g) * smoothstep(.42, .82, up) * (1.0 - rock) * (1.0 - road);
  float dirt = max(0.0, 1.0 - grass - rock - road);
  dGlossiness = grass * .035 + dirt * .018 + rock * .075 + road * .012 + .0000001;
  dGlossiness = mix(dGlossiness, .72, uWorldSurfaceWeather.x * up * (1.0 - grass * .7));
}
`);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("glossPS", `
fn getGlossiness() {
  let normal: vec3f = normalize(dVertexNormalW);
  let up: f32 = clamp(dot(normal, vec3f(0.0, 1.0, 0.0)), 0.0, 1.0);
  let rock: f32 = max(saturate(vVertexColor.r), 1.0 - smoothstep(.48, .76, up));
  let road: f32 = saturate(vVertexColor.a);
  let grass: f32 = saturate(vVertexColor.g) * smoothstep(.42, .82, up) * (1.0 - rock) * (1.0 - road);
  let dirt: f32 = max(0.0, 1.0 - grass - rock - road);
  dGlossiness = grass * .035 + dirt * .018 + rock * .075 + road * .012 + .0000001;
  dGlossiness = mix(dGlossiness, .72, uniform.uWorldSurfaceWeather.x * up * (1.0 - grass * .7));
}
`);
  material.update();
};

/** Adds low-frequency trunk motion and higher-frequency crown flutter without
 * abandoning StandardMaterial, so foliage keeps PBR, sun, probes, and matching
 * animated shadow-map geometry. */
export const configureWorldVegetationMaterial = (material: pc.StandardMaterial, bark = false): void => {
  // Animated vegetation has no motion-vector pass. Specular and normal-map
  // highlights therefore crawl between TAA samples and read as white twinkle.
  // Keep the leaves fully diffuse/matte; geometry, sunlight, and cast shadows
  // still provide their shape.
  if (!bark) material.normalMap = null;
  if (!bark) material.glossMap = null;
  material.metalnessMap = null;
  material.heightMap = null;
  material.clearCoat = 0;
  material.gloss = bark ? .08 : 0;
  material.metalness = 0;
  material.specularityFactor = bark ? .15 : 0;
  material.specular = new pc.Color(bark ? .04 : 0, bark ? .04 : 0, bark ? .04 : 0);
  material.sheen = new pc.Color(0, 0, 0);
  material.shaderChunksVersion = "2.21";
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("transformVS", `
#ifdef PIXELSNAP
uniform vec4 uScreenSize;
#endif
#ifdef SCREENSPACE
uniform float projectionFlipY;
#endif
uniform float uTime;
uniform vec2 uWorldWind;
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
  vec3 localPos = getLocalPosition(vertexPosition);
  float crown = smoothstep(.3, 3.8, localPos.y);
  float trunk = smoothstep(.08, 1.7, localPos.y) * .35;
  vec4 unbentWorld = modelMatrix * vec4(localPos, 1.0);
  float gust = sin(uTime * .68 + unbentWorld.x * .105 + unbentWorld.z * .071);
  float flutter = sin(uTime * 1.4 + unbentWorld.x * .47 - unbentWorld.z * .39 + localPos.y * 1.9);
  localPos.x += (gust * .065 * (trunk + crown) + flutter * .012 * crown) * uWorldWind.x;
  localPos.z += (gust * .038 * (trunk + crown) - flutter * .009 * crown) * uWorldWind.y;
  #ifdef NINESLICED
    localPos.xz *= outerScale;
    vec2 positiveUnitOffset = clamp(vertexPosition.xz, vec2(0.0), vec2(1.0));
    vec2 negativeUnitOffset = clamp(-vertexPosition.xz, vec2(0.0), vec2(1.0));
    localPos.xz += (-positiveUnitOffset * innerOffset.xy + negativeUnitOffset * innerOffset.zw) * vertex_texCoord0.xy;
    vTiledUv = (localPos.xz - outerScale + innerOffset.xy) * -0.5 + 1.0;
    localPos.xz *= -0.5;
    localPos = localPos.xzy;
  #endif
  vec4 posW = modelMatrix * vec4(localPos, 1.0);
  #ifdef SCREENSPACE
    posW.zw = vec2(0.0, 1.0);
  #endif
  return posW;
}
vec4 getPosition() {
  dModelMatrix = getModelMatrix();
  vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
  dPositionW = posW.xyz;
  vec4 screenPos;
  #ifdef UV1LAYOUT
    screenPos = vec4(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1);
    #ifdef WEBGPU
      screenPos.y *= -1.0;
    #endif
  #else
    #ifdef SCREENSPACE
      screenPos = posW;
      screenPos.y *= projectionFlipY;
    #else
      screenPos = matrix_viewProjection * posW;
    #endif
    #ifdef PIXELSNAP
      screenPos.xy = (screenPos.xy * 0.5) + 0.5;
      screenPos.xy *= uScreenSize.xy;
      screenPos.xy = floor(screenPos.xy);
      screenPos.xy *= uScreenSize.zw;
      screenPos.xy = (screenPos.xy * 2.0) - 1.0;
    #endif
  #endif
  return screenPos;
}
vec3 getWorldPosition() { return dPositionW; }
`);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set("transformVS", `
#ifdef PIXELSNAP
  uniform uScreenSize: vec4f;
#endif
#ifdef SCREENSPACE
  uniform projectionFlipY: f32;
#endif
uniform uTime: f32;
uniform uWorldWind: vec2f;
fn evalWorldPosition(vertexPosition: vec3f, modelMatrix: mat4x4f) -> vec4f {
  var localPos: vec3f = getLocalPosition(vertexPosition);
  let crown: f32 = smoothstep(.3, 3.8, localPos.y);
  let trunk: f32 = smoothstep(.08, 1.7, localPos.y) * .35;
  let unbentWorld: vec4f = modelMatrix * vec4f(localPos, 1.0);
  let gust: f32 = sin(uniform.uTime * .68 + unbentWorld.x * .105 + unbentWorld.z * .071);
  let flutter: f32 = sin(uniform.uTime * 1.4 + unbentWorld.x * .47 - unbentWorld.z * .39 + localPos.y * 1.9);
  localPos.x += (gust * .065 * (trunk + crown) + flutter * .012 * crown) * uniform.uWorldWind.x;
  localPos.z += (gust * .038 * (trunk + crown) - flutter * .009 * crown) * uniform.uWorldWind.y;
  #ifdef NINESLICED
    var localPosXZ: vec2f = localPos.xz;
    localPosXZ *= uniform.outerScale;
    let positiveUnitOffset: vec2f = clamp(vertexPosition.xz, vec2f(0.0), vec2f(1.0));
    let negativeUnitOffset: vec2f = clamp(-vertexPosition.xz, vec2f(0.0), vec2f(1.0));
    localPosXZ += (-positiveUnitOffset * uniform.innerOffset.xy + negativeUnitOffset * uniform.innerOffset.zw) * vertex_texCoord0.xy;
    dTiledUvGlobal = (localPosXZ - uniform.outerScale + uniform.innerOffset.xy) * -0.5 + 1.0;
    localPosXZ *= -0.5;
    localPos = vec3f(localPosXZ.x, localPosXZ.y, localPos.y);
  #endif
  var posW: vec4f = modelMatrix * vec4f(localPos, 1.0);
  #ifdef SCREENSPACE
    posW = vec4f(posW.xy, 0.0, 1.0);
  #endif
  return posW;
}
fn getPosition() -> vec4f {
  dModelMatrix = getModelMatrix();
  let posW: vec4f = evalWorldPosition(vertex_position.xyz, dModelMatrix);
  dPositionW = posW.xyz;
  var screenPos: vec4f;
  #ifdef UV1LAYOUT
    screenPos = vec4f(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1.0);
    screenPos.y *= -1.0;
  #else
    #ifdef SCREENSPACE
      screenPos = posW;
      screenPos.y *= uniform.projectionFlipY;
    #else
      screenPos = uniform.matrix_viewProjection * posW;
    #endif
    #ifdef PIXELSNAP
      screenPos.xy = (screenPos.xy * 0.5) + 0.5;
      screenPos.xy *= uniform.uScreenSize.xy;
      screenPos.xy = floor(screenPos.xy);
      screenPos.xy *= uniform.uScreenSize.zw;
      screenPos.xy = (screenPos.xy * 2.0) - 1.0;
    #endif
  #endif
  return screenPos;
}
fn getWorldPosition() -> vec3f { return dPositionW; }
`);
  material.setParameter("uTime", 0);
  material.setParameter("uWorldWind", [1,1]);
  material.update();
};

export const createFresnelSelectionMaterial = (): pc.ShaderMaterial => {
  const material = shader("selection-fresnel", `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 matrix_model;
uniform mat3 matrix_normal;
uniform mat4 matrix_viewProjection;
uniform vec3 view_position;
varying vec3 vNormal;
varying vec3 vViewDir;
void main(void) {
  vec4 world = matrix_model * vec4(aPosition, 1.0);
  vNormal = normalize(matrix_normal * aNormal);
  vViewDir = view_position - world.xyz;
  gl_Position = matrix_viewProjection * world;
}`, `
precision highp float;
uniform vec3 uHighlightColor;
uniform float uFresnelPower;
uniform float uPulseSpeed;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vViewDir;
void main(void) {
  float edge = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), uFresnelPower);
  float pulse = 1.0 + .08 * sin(uTime * uPulseSpeed);
  float alpha = .07 + edge * .38 * pulse;
  if (alpha < .025) discard;
  gl_FragColor = vec4(uHighlightColor * (.42 + edge * .8), alpha);
}`, { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL });
  material.blendType = pc.BLEND_ADDITIVEALPHA;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_BACK;
  material.setParameter("uHighlightColor", [.22, .86, .43]);
  material.setParameter("uFresnelPower", 2.8);
  material.setParameter("uPulseSpeed", 2);
  material.setParameter("uTime", 0);
  material.update();
  return material;
};

/** Soft tabletop contact decal used to ground dynamic miniatures without another shadow map. */
export const createBlobShadowMaterial = (): pc.ShaderMaterial => {
  const material = shader("miniature-blob-shadow", `
attribute vec3 aPosition;
attribute vec2 aUv0;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec2 vUv;
void main(void) {
  vUv = aUv0;
  gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
}`, `
precision highp float;
varying vec2 vUv;
uniform float uShadowOpacity;
void main(void) {
  float radius = length((vUv - .5) * 2.0);
  float core = 1.0 - smoothstep(.08, 1.0, radius);
  float alpha = core * core * uShadowOpacity;
  if (alpha < .006) discard;
  gl_FragColor = vec4(vec3(.015, .018, .024), alpha);
}`, { aPosition: pc.SEMANTIC_POSITION, aUv0: pc.SEMANTIC_TEXCOORD0 });
  material.blendType = pc.BLEND_NORMAL;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.setParameter("uShadowOpacity", .34);
  material.update();
  return material;
};

const resinMicroMaps = new WeakMap<pc.GraphicsDevice, { normal: pc.Texture; gloss: pc.Texture; thickness: pc.Texture }>();

const createResinMicroMaps = (device: pc.GraphicsDevice): { normal: pc.Texture; gloss: pc.Texture; thickness: pc.Texture } => {
  const cached = resinMicroMaps.get(device);
  if (cached) return cached;
  const size = 128;
  const textureFromCanvas = (name: string, canvas: HTMLCanvasElement) => {
    const texture = new pc.Texture(device, { name, width: size, height: size, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
    texture.addressU = pc.ADDRESS_REPEAT;
    texture.addressV = pc.ADDRESS_REPEAT;
    texture.anisotropy = 8;
    texture.setSource(canvas);
    return texture;
  };
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalContext = normalCanvas.getContext("2d")!;
  const normalImage = normalContext.createImageData(size, size);
  const glossCanvas = document.createElement("canvas");
  glossCanvas.width = size;
  glossCanvas.height = size;
  const glossContext = glossCanvas.getContext("2d")!;
  const glossImage = glossContext.createImageData(size, size);
  const thicknessCanvas = document.createElement("canvas");
  thicknessCanvas.width = size;
  thicknessCanvas.height = size;
  const thicknessContext = thicknessCanvas.getContext("2d")!;
  const thicknessImage = thicknessContext.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const grain = hash2d(x, y, 907);
    const neighbor = hash2d(x + 1, y + 1, 907);
    const scratch = (x * 17 + y * 31) % 113 === 0 ? -18 : 0;
    normalImage.data.set([128 + Math.round((grain - .5) * 7), 128 + Math.round((neighbor - .5) * 7), 255, 255], index);
    const gloss = Math.max(185, Math.min(250, 229 + Math.round((grain - .5) * 18) + scratch));
    glossImage.data.set([gloss, gloss, gloss, 255], index);
    // Equirectangular convex-volume approximation: the equator is optically
    // thicker while poles and beveled seams transmit more light.
    const latitude = Math.sin(Math.PI * (y + .5) / size);
    const seam = Math.min(x, size - 1 - x) / (size * .08);
    const thickness = Math.max(.22, Math.min(1, .3 + Math.pow(latitude, .62) * .7 - Math.max(0, 1 - seam) * .14));
    const thicknessValue = Math.round(thickness * 255);
    thicknessImage.data.set([thicknessValue, thicknessValue, thicknessValue, 255], index);
  }
  normalContext.putImageData(normalImage, 0, 0);
  glossContext.putImageData(glossImage, 0, 0);
  thicknessContext.putImageData(thicknessImage, 0, 0);
  const maps = {
    normal: textureFromCanvas("molded-resin-micro-normal", normalCanvas),
    gloss: textureFromCanvas("molded-resin-micro-gloss", glossCanvas),
    thickness: textureFromCanvas("convex-resin-thickness", thicknessCanvas),
  };
  resinMicroMaps.set(device, maps);
  return maps;
};

export const createResinDiceMaterial = (base: [number, number, number], device?: pc.GraphicsDevice): pc.StandardMaterial => {
  const material = new pc.StandardMaterial();
  // PlayCanvas exposes its glTF volume fields at runtime, but the generated
  // StandardMaterial class declaration currently omits them.
  const volume = material as pc.StandardMaterial & {
    useDynamicRefraction: boolean;
    thickness: number;
    thicknessMap: pc.Texture | null;
    thicknessMapChannel: string;
    attenuation: pc.Color;
    attenuationDistance: number;
  };
  material.name = "Clear-coated tabletop plastic";
  material.useMetalness = true;
  material.metalness = 0;
  material.diffuse = new pc.Color(base[0], base[1], base[2]);
  material.gloss = .84;
  material.specularityFactor = .62;
  material.fresnelModel = pc.FRESNEL_SCHLICK;
  material.clearCoat = 1;
  material.clearCoatGloss = .96;
  material.refraction = .13;
  material.refractionIndex = 1 / 1.49;
  volume.useDynamicRefraction = true;
  volume.thickness = .68;
  volume.attenuation = new pc.Color(Math.max(.12, base[0]), Math.max(.12, base[1]), Math.max(.12, base[2]));
  volume.attenuationDistance = 2.4;
  if (device) {
    const maps = createResinMicroMaps(device);
    material.normalMap = maps.normal;
    material.bumpiness = .12;
    material.glossMap = maps.gloss;
    material.glossMapChannel = "r";
    material.clearCoatNormalMap = maps.normal;
    material.clearCoatBumpiness = .08;
    volume.thicknessMap = maps.thickness;
    volume.thicknessMapChannel = "r";
  }
  material.opacity = 1;
  material.blendType = pc.BLEND_NONE;
  material.depthWrite = true;
  material.update();
  return material;
};

export type ProceduralSurface = "stone" | "wood" | "metal" | "flesh" | "fabric" | "foliage" | "paper" | "water";

const hash2d = (x: number, y: number, seed: number): number => {
  let value = Math.imul(x, 374_761_393) ^ Math.imul(y, 668_265_263) ^ Math.imul(seed, 1_442_695_041);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
};

const wrap = (value: number, period: number): number => ((value % period) + period) % period;
const smooth = (value: number): number => value * value * (3 - 2 * value);

export const seamlessValueNoise = (x: number, y: number, cellSize: number, period: number, seed: number): number => {
  const gridX = Math.floor(x / cellSize);
  const gridY = Math.floor(y / cellSize);
  const fractionX = smooth((x / cellSize) - gridX);
  const fractionY = smooth((y / cellSize) - gridY);
  const sample = (offsetX: number, offsetY: number) => hash2d(wrap(gridX + offsetX, period), wrap(gridY + offsetY, period), seed);
  const top = pc.math.lerp(sample(0, 0), sample(1, 0), fractionX);
  const bottom = pc.math.lerp(sample(0, 1), sample(1, 1), fractionX);
  return pc.math.lerp(top, bottom, fractionY);
};

export const createProceduralPbrMaps = (app: pc.Application, surface: ProceduralSurface): { albedo: pc.Texture; normal: pc.Texture; orm: pc.Texture; specialty: pc.Texture; height: pc.Texture } => {
  const size = 256;
  const make = (name: string, painter: (context: CanvasRenderingContext2D) => void, srgb = false) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;
    painter(context);
    const texture = new pc.Texture(app.graphicsDevice, { name: `${surface}-${name}`, width: size, height: size, format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR });
    texture.addressU = pc.ADDRESS_REPEAT;
    texture.addressV = pc.ADDRESS_REPEAT;
    texture.anisotropy = 8;
    texture.setSource(canvas);
    return texture;
  };
  const seed = { stone: 17, wood: 41, metal: 73, flesh: 101, fabric: 131, foliage: 163, paper: 191, water: 223 }[surface];
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = seamlessValueNoise(x, y, 32, size / 32, seed);
    const detail = seamlessValueNoise(x, y, 8, size / 8, seed + 19);
    const grain = hash2d(x, y, seed + 47);
    const woodGrain = .5 + .5 * Math.sin((y + broad * 16 + Math.sin(x * .028) * 5) * .16);
    const brushedMetal = .5 + .5 * Math.sin(y * 1.7 + broad * 3);
    const fabricWeave = (.5 + .25 * Math.sin(x * Math.PI / 2) + .25 * Math.sin(y * Math.PI / 2));
    height[y * size + x] = surface === "wood" ? broad * .38 + detail * .24 + woodGrain * .28 + grain * .1
      : surface === "stone" ? broad * .52 + detail * .34 + grain * .14
      : surface === "metal" ? broad * .16 + brushedMetal * .2 + grain * .64
      : surface === "fabric" ? broad * .18 + fabricWeave * .62 + grain * .2
      : surface === "foliage" ? broad * .24 + detail * .3 + grain * .46
      : surface === "paper" ? broad * .1 + detail * .08 + grain * .82
      : surface === "water" ? broad * .44 + detail * .42 + grain * .14
      : broad * .5 + detail * .32 + grain * .18;
  }
  const at = (x: number, y: number) => height[wrap(y, size) * size + wrap(x, size)];
  const albedo = make("albedo", (context) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const variation = surface === "stone" ? 52 : surface === "wood" ? 38 : surface === "metal" ? 28 : surface === "foliage" ? 34 : surface === "paper" ? 12 : surface === "water" ? 18 : 20;
      const base = surface === "wood" ? 185 : surface === "stone" ? 198 : surface === "metal" ? 214 : surface === "foliage" ? 188 : surface === "paper" ? 238 : surface === "water" ? 210 : 205;
      const value = Math.max(90, Math.min(250, Math.round(base + (at(x, y) - .5) * variation)));
      const index = (y * size + x) * 4;
      image.data.set([value, value, value, 255], index);
    }
    context.putImageData(image, 0, 0);
  }, true);
  const normal = make("normal", (context) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const strength = surface === "stone" ? 78 : surface === "wood" ? 52 : surface === "fabric" ? 48 : surface === "foliage" ? 64 : surface === "paper" ? 14 : surface === "water" ? 86 : 32;
      const nx = Math.round(128 + (at(x - 1, y) - at(x + 1, y)) * strength);
      const ny = Math.round(128 + (at(x, y - 1) - at(x, y + 1)) * strength);
      image.data.set([nx, ny, 252, 255], (y * size + x) * 4);
    }
    context.putImageData(image, 0, 0);
  });
  // Packed AO / Roughness / Metallic texture: one sample replaces the three
  // independent maps used by the original procedural material path.
  const roughnessValue = { stone: .78, wood: .82, metal: .28, flesh: .68, fabric: .86, foliage: .92, paper: .74, water: .16 }[surface];
  const metalnessValue = surface === "metal" ? .92 : .015;
  const orm = make("orm", (context) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const cavity = Math.round((.69 + at(x, y) * .31) * 255);
      const roughness = Math.max(.08, Math.min(.98, roughnessValue + (at(x, y) - .5) * (surface === "wood" ? .12 : .07)));
      image.data.set([cavity, Math.round(roughness * 255), Math.round(metalnessValue * 255), 255], (y * size + x) * 4);
    }
    context.putImageData(image, 0, 0);
  });
  // R curvature, G thickness, B emissive mask. Curvature is derived from the
  // height field's convex Laplacian and local gradient, matching a baked
  // specialty map closely enough for generated low-poly pieces.
  const specialty = make("specialty", (context) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const center = at(x, y);
      const average = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) * .25;
      const gradient = Math.abs(at(x - 1, y) - at(x + 1, y)) + Math.abs(at(x, y - 1) - at(x, y + 1));
      const curvature = Math.max(0, Math.min(1, Math.max(0, center - average) * 11 + gradient * .24));
      const baseThickness = surface === "paper" ? .72 : surface === "flesh" ? .66 : surface === "foliage" ? .42 : .16;
      const thickness = Math.max(.05, Math.min(1, baseThickness + (center - .5) * .16));
      image.data.set([Math.round(curvature * 255), Math.round(thickness * 255), 0, 255], (y * size + x) * 4);
    }
    context.putImageData(image, 0, 0);
  });
  const heightMap = make("height", (context) => {
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const value = Math.round(at(x, y) * 255);
      image.data.set([value, value, value, 255], (y * size + x) * 4);
    }
    context.putImageData(image, 0, 0);
  });
  return { albedo, normal, orm, specialty, height: heightMap };
};
