import * as pc from "playcanvas";

const hash3 = (x: number, y: number, z: number, seed: number): number => {
  let value = Math.imul(x + seed, 374_761_393) ^ Math.imul(y - seed, 668_265_263) ^ Math.imul(z + seed * 3, 1_442_695_041);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
};

const smooth = (value: number): number => value * value * (3 - 2 * value);
const wrap = (value: number, period: number): number => ((value % period) + period) % period;

const valueNoise3 = (x: number, y: number, z: number, frequency: number, seed: number): number => {
  const px = x * frequency, py = y * frequency, pz = z * frequency;
  const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz), period = Math.max(1, Math.floor(frequency));
  const tx = smooth(px - x0), ty = smooth(py - y0), tz = smooth(pz - z0);
  const sample = (dx: number, dy: number, dz: number) => hash3(wrap(x0 + dx, period), wrap(y0 + dy, period), wrap(z0 + dz, period), seed);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const low = lerp(lerp(sample(0, 0, 0), sample(1, 0, 0), tx), lerp(sample(0, 1, 0), sample(1, 1, 0), tx), ty);
  const high = lerp(lerp(sample(0, 0, 1), sample(1, 0, 1), tx), lerp(sample(0, 1, 1), sample(1, 1, 1), tx), ty);
  return lerp(low, high, tz);
};

const worley3 = (x: number, y: number, z: number, cells: number, seed: number): number => {
  const px = x / 32 * cells, py = y / 32 * cells, pz = z / 32 * cells;
  const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
  let nearest = Number.POSITIVE_INFINITY;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const gx = wrap(cx + dx, cells), gy = wrap(cy + dy, cells), gz = wrap(cz + dz, cells);
    const fx = cx + dx + hash3(gx, gy, gz, seed + 11), fy = cy + dy + hash3(gx, gy, gz, seed + 29), fz = cz + dz + hash3(gx, gy, gz, seed + 47);
    nearest = Math.min(nearest, Math.hypot(px - fx, py - fy, pz - fz));
  }
  return Math.min(1, nearest / 1.15);
};

const createNoiseVolume = (device: pc.GraphicsDevice, name: string, seed: number, detail: boolean): pc.Texture => {
  const size = 32;
  const texture = new pc.Texture(device, {
    name, width: size, height: size, depth: size, volume: true, format: pc.PIXELFORMAT_R8,
    mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, addressW: pc.ADDRESS_REPEAT,
  });
  const pixels = texture.lock() as Uint8Array;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const macro = valueNoise3(x, y, z, detail ? 8 : 4, seed);
    const octave = valueNoise3(x, y, z, detail ? 16 : 8, seed + 101);
    const cells = 1 - worley3(x, y, z, detail ? 12 : 5, seed + 307);
    const density = detail ? cells * .62 + octave * .38 : macro * .48 + octave * .22 + cells * .3;
    pixels[(z * size + y) * size + x] = Math.round(Math.max(0, Math.min(1, density)) * 255);
  }
  texture.unlock();
  return texture;
};

const CLOUD_FRAGMENT = `
precision highp float;
varying vec2 vUv0;
uniform sampler2D uColorBuffer;
uniform sampler2D uSceneDepthMap;
uniform sampler3D uBaseNoise;
uniform sampler3D uDetailNoise;
uniform vec3 uCameraPosition;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform vec3 uCameraForward;
uniform vec3 uSunDirection;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uTime;
uniform float uCoverage;

float cloudDensity(vec3 worldPosition) {
  vec3 wind = vec3(uTime * .00075, 0.0, uTime * .00034);
  vec3 macroUv = fract(worldPosition * vec3(.006, .021, .006) + wind);
  vec3 detailUv = fract(worldPosition * vec3(.024, .061, .024) - wind * 1.7);
  // PlayCanvas' GLSL-to-WGSL processor identifies volume texture accesses by
  // their legacy function name. The generic texture function reaches WebGL but is
  // emitted with the wrong overload on WebGPU.
  float base = texture3D(uBaseNoise, macroUv).r;
  float detail = texture3D(uDetailNoise, detailUv).r;
  float height = clamp((worldPosition.y - 28.0) / 24.0, 0.0, 1.0);
  float profile = smoothstep(0.0, .18, height) * (1.0 - smoothstep(.68, 1.0, height));
  return max(0.0, base * profile - mix(.7, .38, uCoverage) - detail * .2);
}

void main(void) {
  vec3 scene = texture2D(uColorBuffer, vUv0).rgb;
  float sceneDepth = texture2D(uSceneDepthMap, vUv0).r;
  float background = max(step(.9994, sceneDepth), step(sceneDepth, .0006));
  if (background < .5 || uCoverage <= .001) { gl_FragColor = vec4(scene, 1.0); return; }
  vec2 ndc = vUv0 * 2.0 - 1.0;
  vec3 ray = normalize(uCameraForward + uCameraRight * ndc.x * uTanHalfFov * uAspect + uCameraUp * ndc.y * uTanHalfFov);
  if (abs(ray.y) < .0001) { gl_FragColor = vec4(scene, 1.0); return; }
  float slabA = (28.0 - uCameraPosition.y) / ray.y;
  float slabB = (52.0 - uCameraPosition.y) / ray.y;
  float start = max(0.0, min(slabA, slabB));
  float finish = min(320.0, max(slabA, slabB));
  if (finish <= start) { gl_FragColor = vec4(scene, 1.0); return; }
  float stepLength = (finish - start) / 18.0;
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 accumulated = vec3(0.0);
  float alpha = 0.0;
  vec3 sunDirection = normalize(-uSunDirection);
  for (int index = 0; index < 18; index++) {
    float travel = start + (float(index) + jitter) * stepLength;
    vec3 position = uCameraPosition + ray * travel;
    float density = cloudDensity(position) * 2.4;
    if (density > .002) {
      float sunOpticalDepth = 0.0;
      for (int lightStep = 1; lightStep <= 4; lightStep++) sunOpticalDepth += cloudDensity(position + sunDirection * float(lightStep) * 5.0);
      float beer = exp(-sunOpticalDepth * .72);
      vec3 cloudColor = mix(vec3(.32, .37, .42), vec3(1.0, .96, .86), .2 + beer * .8);
      float sampleAlpha = 1.0 - exp(-density * stepLength * .11);
      accumulated += (1.0 - alpha) * cloudColor * sampleAlpha;
      alpha += (1.0 - alpha) * sampleAlpha;
      if (alpha > .965) break;
    }
  }
  gl_FragColor = vec4(scene * (1.0 - alpha) + accumulated, 1.0);
}`;

export class VolumetricCloudEffect extends pc.PostEffect {
  private readonly shader: pc.Shader;
  private readonly baseNoise: pc.Texture;
  private readonly detailNoise: pc.Texture;
  private coverage = .48;
  private time = 0;

  constructor(device: pc.GraphicsDevice, private readonly cameraEntity: pc.Entity) {
    super(device);
    this.needsDepthBuffer = true;
    this.baseNoise = createNoiseVolume(device, "DnDRom Perlin-Worley cloud base", 1709, false);
    this.detailNoise = createNoiseVolume(device, "DnDRom Worley cloud detail", 2903, true);
    this.shader = pc.createShaderFromCode(device, pc.PostEffect.quadVertexShader, CLOUD_FRAGMENT, "dndrom-volumetric-clouds-v1", { aPosition: pc.SEMANTIC_POSITION });
  }

  setCoverage(value: number): void { this.coverage = Math.max(0, Math.min(1, value)); }
  setTime(value: number): void { this.time = value; }

  override render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget, rect?: pc.Vec4): void {
    const camera = this.cameraEntity.camera;
    const scope = this.device.scope;
    scope.resolve("uColorBuffer").setValue(inputTarget.colorBuffer);
    scope.resolve("uBaseNoise").setValue(this.baseNoise);
    scope.resolve("uDetailNoise").setValue(this.detailNoise);
    const position = this.cameraEntity.getPosition(), right = this.cameraEntity.right, up = this.cameraEntity.up, forward = this.cameraEntity.forward;
    scope.resolve("uCameraPosition").setValue(new Float32Array([position.x, position.y, position.z]));
    scope.resolve("uCameraRight").setValue(new Float32Array([right.x, right.y, right.z]));
    scope.resolve("uCameraUp").setValue(new Float32Array([up.x, up.y, up.z]));
    scope.resolve("uCameraForward").setValue(new Float32Array([forward.x, forward.y, forward.z]));
    scope.resolve("uSunDirection").setValue(new Float32Array([.35, -.84, .4]));
    scope.resolve("uTanHalfFov").setValue(Math.tan(((camera?.fov ?? 52) * Math.PI / 180) / 2));
    scope.resolve("uAspect").setValue(this.device.width / Math.max(1, this.device.height));
    scope.resolve("uTime").setValue(this.time);
    scope.resolve("uCoverage").setValue(this.coverage);
    this.drawQuad(outputTarget, this.shader, rect);
  }

  destroy(): void {
    this.shader.destroy();
    this.baseNoise.destroy();
    this.detailNoise.destroy();
  }
}
