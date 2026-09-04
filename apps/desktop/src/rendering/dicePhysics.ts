import RAPIER from "@dimforge/rapier3d-compat";

export interface PhysicsVector {
  x: number;
  y: number;
  z: number;
}

export interface PhysicsQuaternion extends PhysicsVector {
  w: number;
}

export interface DicePhysicsFrame {
  position: PhysicsVector;
  rotation: PhysicsQuaternion;
}

export interface DicePhysicsInput {
  vertices: PhysicsVector[];
  faces: number[][];
  spawn: PhysicsVector;
  landingHint: PhysicsVector;
}

export interface DicePhysicsResult {
  frames: DicePhysicsFrame[];
  topFaceIndex: number;
}

export interface DiceTrayBounds {
  width: number;
  depth: number;
}

const ready = RAPIER.init();
const FIXED_STEP = 1 / 120;
const CAPTURE_EVERY = 2;
const MAX_STEPS = 540;

const randomRange = (random: () => number, minimum: number, maximum: number): number => minimum + (maximum - minimum) * random();

const randomQuaternion = (random: () => number): PhysicsQuaternion => {
  const u1 = random();
  const u2 = random();
  const u3 = random();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return {
    x: a * Math.sin(2 * Math.PI * u2),
    y: a * Math.cos(2 * Math.PI * u2),
    z: b * Math.sin(2 * Math.PI * u3),
    w: b * Math.cos(2 * Math.PI * u3),
  };
};

const rotateVector = (vector: PhysicsVector, quaternion: PhysicsQuaternion): PhysicsVector => {
  const qVector = { x: quaternion.x, y: quaternion.y, z: quaternion.z };
  const cross = {
    x: qVector.y * vector.z - qVector.z * vector.y,
    y: qVector.z * vector.x - qVector.x * vector.z,
    z: qVector.x * vector.y - qVector.y * vector.x,
  };
  const secondCross = {
    x: qVector.y * cross.z - qVector.z * cross.y,
    y: qVector.z * cross.x - qVector.x * cross.z,
    z: qVector.x * cross.y - qVector.y * cross.x,
  };
  return {
    x: vector.x + 2 * (quaternion.w * cross.x + secondCross.x),
    y: vector.y + 2 * (quaternion.w * cross.y + secondCross.y),
    z: vector.z + 2 * (quaternion.w * cross.z + secondCross.z),
  };
};

const faceNormal = (input: DicePhysicsInput, face: number[]): PhysicsVector => {
  const a = input.vertices[face[0]];
  const b = input.vertices[face[1]];
  const c = input.vertices[face[2]];
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
};

const topFaceIndex = (input: DicePhysicsInput, rotation: PhysicsQuaternion): number => {
  let selected = 0;
  let highest = -Infinity;
  input.faces.forEach((face, index) => {
    const worldNormal = rotateVector(faceNormal(input, face), rotation);
    if (worldNormal.y > highest) {
      highest = worldNormal.y;
      selected = index;
    }
  });
  return selected;
};

export const simulateDicePhysics = async (
  inputs: DicePhysicsInput[],
  bounds: DiceTrayBounds,
  random: () => number = Math.random,
): Promise<DicePhysicsResult[]> => {
  await ready;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_STEP;
  const halfWidth = Math.max(4, bounds.width / 2);
  const halfDepth = Math.max(4, bounds.depth / 2);
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth + .65, .16, halfDepth + .65).setTranslation(0, -.16, 0).setFriction(.94).setRestitution(.18));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.32, 2.5, halfDepth + .5).setTranslation(-halfWidth, 2.35, 0).setFriction(.84).setRestitution(.26));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.32, 2.5, halfDepth + .5).setTranslation(halfWidth, 2.35, 0).setFriction(.84).setRestitution(.26));
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth + .5, 2.5, .32).setTranslation(0, 2.35, -halfDepth).setFriction(.84).setRestitution(.26));
  world.createCollider(RAPIER.ColliderDesc.cuboid(halfWidth + .5, 2.5, .32).setTranslation(0, 2.35, halfDepth).setFriction(.84).setRestitution(.26));

  const bodies = inputs.map((input, index) => {
    const start = randomQuaternion(random);
    const spawn = {
      x: Math.max(-halfWidth + .85, Math.min(halfWidth - .85, input.spawn.x)),
      y: input.spawn.y + index * .08,
      z: Math.max(-halfDepth + .85, Math.min(halfDepth - .85, input.spawn.z)),
    };
    const flight = randomRange(random, 1.05, 1.32);
    const velocity = {
      x: (input.landingHint.x - spawn.x) / flight + randomRange(random, -.65, .65),
      y: randomRange(random, 3.9, 5.15),
      z: (input.landingHint.z - spawn.z) / flight + randomRange(random, -.85, .85),
    };
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation(start)
        .setLinvel(velocity.x, velocity.y, velocity.z)
        .setAngvel({
          x: randomRange(random, -21, 21),
          y: randomRange(random, -25, 25),
          z: randomRange(random, -22, 22),
        })
        .setLinearDamping(randomRange(random, .52, .74))
        .setAngularDamping(randomRange(random, .66, .92))
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setAdditionalSolverIterations(4),
    );
    const points = new Float32Array(input.vertices.flatMap((vertex) => [vertex.x, vertex.y, vertex.z]));
    const collider = RAPIER.ColliderDesc.roundConvexHull(points, .025) ?? RAPIER.ColliderDesc.convexHull(points);
    if (!collider) throw new Error("Could not construct the die collision hull");
    world.createCollider(
      collider
        .setDensity(randomRange(random, .92, 1.18))
        .setFriction(randomRange(random, .76, .96))
        .setRestitution(randomRange(random, .24, .36)),
      body,
    );
    return body;
  });

  const frames = inputs.map(() => [] as DicePhysicsFrame[]);
  const capture = () => bodies.forEach((body, index) => {
    const position = body.translation();
    const rotation = body.rotation();
    frames[index].push({
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    });
  });
  capture();
  for (let step = 1; step <= MAX_STEPS; step++) {
    world.step();
    if (step % CAPTURE_EVERY === 0) capture();
    if (step > 150 && bodies.every((body) => body.isSleeping())) break;
    if (step === 420) bodies.forEach((body) => {
      if (body.linvel().y < .08 && Math.hypot(body.linvel().x, body.linvel().z) < .18 && body.angvel().x ** 2 + body.angvel().y ** 2 + body.angvel().z ** 2 < .3) body.sleep();
    });
  }
  const results = inputs.map((input, index) => {
    const trajectory = frames[index];
    const final = trajectory[trajectory.length - 1];
    return { frames: trajectory, topFaceIndex: topFaceIndex(input, final.rotation) };
  });
  world.free();
  return results;
};
