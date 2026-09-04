import type { TokenAnimation, TokenAnimationKind, TokenAsset, TokenMotionProfile, TokenVisualState } from "./types";

export interface TokenFormGroup {
  id: string;
  name: string;
  styles: TokenVisualState[];
}

export interface TokenMotionTransform {
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
  complete: boolean;
}

const profileForPrompt = (prompt: string, kind: TokenAnimationKind): TokenMotionProfile => {
  const value = prompt.toLowerCase();
  if (/hover|float|levitat|fly/.test(value)) return "hover";
  if (/prowl|sneak|stalk|crouch/.test(value)) return "prowl";
  if (/slash|sword|claw|swipe/.test(value)) return "slash";
  if (/slam|smash|hammer|stomp/.test(value)) return "slam";
  if (/spin|whirl|twirl/.test(value)) return "spin";
  if (/cast|spell|magic|channel|summon/.test(value)) return "cast";
  if (/roar|shout|howl|taunt/.test(value)) return "roar";
  if (/transform|shift|power.?up|burst|explode/.test(value)) return "burst";
  if (/lunge|thrust|charge|pounce|attack/.test(value) || kind === "attack") return "lunge";
  return "breathe";
};

export function compileTokenAnimation(prompt: string, kind: TokenAnimationKind, current?: Partial<TokenAnimation>): TokenAnimation {
  const cleanPrompt = prompt.trim() || (kind === "idle" ? "Breathe gently while standing ready" : "Lunge forward with a decisive attack");
  const motion = profileForPrompt(cleanPrompt, kind);
  const looping = kind === "idle";
  return {
    id: current?.id ?? `token-animation-${crypto.randomUUID()}`,
    name: current?.name?.trim() || (kind === "idle" ? "Idle" : kind === "attack" ? "Attack" : kind[0].toUpperCase() + kind.slice(1)),
    kind,
    prompt: cleanPrompt,
    motion,
    loop: current?.loop ?? looping,
    duration: Math.min(12, Math.max(.35, current?.duration ?? (looping ? 3.2 : motion === "slam" ? 1.15 : 0.9))),
    intensity: Math.min(2, Math.max(.1, current?.intensity ?? 1)),
    source: current?.source ?? "procedural",
    sourceFile: current?.sourceFile,
  };
}

/**
 * Procedural motion is derived from its description. Older Forge drafts could
 * retain a stale profile after their prompt changed, which made a calm idle
 * use the full-body spin/burst transform on the tabletop. Reconcile only
 * procedural clips; authored skeletal animation metadata remains untouched.
 */
export function normalizeTokenAnimation(animation: TokenAnimation): TokenAnimation {
  if (animation.source !== "procedural") return animation;
  const motion = profileForPrompt(animation.prompt, animation.kind);
  return motion === animation.motion ? animation : { ...animation, motion };
}

export function normalizeTokenAssetAnimations(token: TokenAsset): TokenAsset {
  if (!token.states?.length) return token;
  let changed = false;
  const states = token.states.map((state) => {
    let stateChanged = false;
    const animations = state.animations.map((animation) => {
      const normalized = normalizeTokenAnimation(animation);
      if (normalized !== animation) { changed = true; stateChanged = true; }
      return normalized;
    });
    return stateChanged ? { ...state, animations } : state;
  });
  return changed ? { ...token, states } : token;
}

export function defaultTokenAnimations(): TokenAnimation[] {
  return [
    compileTokenAnimation("Breathe gently and shift weight while standing ready", "idle", { id: `token-animation-${crypto.randomUUID()}`, name: "Ready idle", loop: true }),
    compileTokenAnimation("Lunge forward and slash, then return to the starting pose", "attack", { id: `token-animation-${crypto.randomUUID()}`, name: "Primary attack", loop: false }),
  ];
}

export function resolveTokenStates(token: TokenAsset): TokenVisualState[] {
  if (token.states?.length) return token.states;
  return [{
    id: token.defaultStateId ?? `${token.id}-default`,
    name: "Default",
    storageKey: token.storageKey,
    filename: token.filename,
    byteLength: token.byteLength,
    modelScale: token.modelScale,
    modelLift: token.modelLift,
    animations: [],
    createdAt: token.createdAt,
  }];
}

export function resolveTokenState(token: TokenAsset, stateId?: string): TokenVisualState {
  const states = resolveTokenStates(token);
  return states.find((state) => state.id === stateId)
    ?? states.find((state) => state.id === token.defaultStateId)
    ?? states[0];
}

export function resolveTokenForms(token: TokenAsset): TokenFormGroup[] {
  const groups = new Map<string, TokenFormGroup>();
  for (const state of resolveTokenStates(token)) {
    const formId = state.formId ?? state.id;
    const group = groups.get(formId) ?? { id: formId, name: state.name, styles: [] };
    group.styles.push(state);
    groups.set(formId, group);
  }
  return [...groups.values()];
}

const neutral = (complete = false): TokenMotionTransform => ({ y: 0, yaw: 0, pitch: 0, roll: 0, scale: 1, complete });

export function tokenMotionAt(animation: TokenAnimation, elapsedSeconds: number, reducedMotion = false): TokenMotionTransform {
  if (reducedMotion) return neutral(!animation.loop && elapsedSeconds >= animation.duration);
  const duration = Math.max(.1, animation.duration);
  if (!animation.loop && elapsedSeconds >= duration) return neutral(true);
  const phase = animation.loop ? (elapsedSeconds % duration) / duration : Math.min(1, elapsedSeconds / duration);
  const wave = Math.sin(phase * Math.PI * 2);
  const envelope = animation.loop ? 1 : Math.sin(phase * Math.PI);
  const strength = animation.intensity;
  switch (animation.motion) {
    case "hover": return { ...neutral(), y: (.08 + wave * .045) * strength, pitch: wave * 1.5 * strength };
    case "prowl": return { ...neutral(), y: Math.max(0, wave) * .025 * strength, yaw: wave * 4 * strength, scale: 1 - .025 * strength };
    case "lunge": return { ...neutral(), y: Math.sin(phase * Math.PI) * .05 * strength, pitch: -envelope * 13 * strength, scale: 1 + envelope * .045 * strength };
    case "slash": return { ...neutral(), yaw: Math.sin(phase * Math.PI * 2) * 24 * envelope * strength, roll: -Math.sin(phase * Math.PI) * 8 * strength };
    case "slam": return { ...neutral(), y: Math.max(0, Math.sin(phase * Math.PI)) * .22 * strength, pitch: phase < .55 ? -envelope * 10 * strength : envelope * 5 * strength, scale: 1 + Math.max(0, phase - .55) * (1 - phase) * .28 * strength };
    case "spin": return { ...neutral(), yaw: phase * 360 * strength, y: envelope * .08 * strength };
    case "cast": return { ...neutral(), y: envelope * .05 * strength, yaw: wave * 5 * strength, scale: 1 + envelope * .07 * strength };
    case "roar": return { ...neutral(), pitch: -envelope * 8 * strength, scale: 1 + envelope * .1 * strength };
    case "burst": return { ...neutral(), y: envelope * .1 * strength, yaw: phase * 180 * strength, scale: 1 + envelope * .16 * strength };
    case "breathe":
    default: return { ...neutral(), y: wave * .012 * strength, pitch: wave * .65 * strength, scale: 1 + wave * .012 * strength };
  }
}
