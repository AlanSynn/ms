export const PHYSICS_KERNEL_ENGINE = 'rapier3d-compat' as const;
export const PHYSICS_KERNEL_IMPORT = '@dimforge/rapier3d-compat' as const;
export const PHYSICS_RENDER_STACK = 'three-webgl2-imperative' as const;
export const PHYSICS_UPDATE_POLICY = 'kinematic-authority-rapier-contact-validation' as const;
export const HIGH_THROUGHPUT_SCENE_POLICY = 'viser-style-transform-tree-batched-updates-instancing' as const;

export const PHYSICS_KERNEL_TARGETS = Object.freeze({
  targetFps: 60,
  foundryCommitHz: 30,
  maxMainThreadDynamicBuildHz: 35,
  maxDevicePixelRatio: 1.5,
  manyPartSceneGoal: 'batched transforms before new GPU objects' as const
});

type RapierModule = typeof import('@dimforge/rapier3d-compat');

let rapierModulePromise: Promise<RapierModule> | null = null;

export const loadRapierPhysicsKernel = async (): Promise<RapierModule> => {
  if (!rapierModulePromise) {
    rapierModulePromise = import('@dimforge/rapier3d-compat').then(async module => {
      await module.init();
      return module;
    });
  }
  return rapierModulePromise;
};


export const physicsKernelErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) || 'unknown physics kernel error';
  } catch {
    return 'unknown physics kernel error';
  }
};

export interface PhysicsKernelCapability {
  renderStack: typeof PHYSICS_RENDER_STACK;
  physicsKernel: typeof PHYSICS_KERNEL_ENGINE;
  importSpecifier: typeof PHYSICS_KERNEL_IMPORT;
  updatePolicy: typeof PHYSICS_UPDATE_POLICY;
  scenePolicy: typeof HIGH_THROUGHPUT_SCENE_POLICY;
  mechanismAuthority: 'MotionSmith kinematics + fabrication constraints';
  contactAuthority: 'Rapier collider contact/friction solver';
  throughputTargets: typeof PHYSICS_KERNEL_TARGETS;
}

export const physicsKernelCapability = (): PhysicsKernelCapability => ({
  renderStack: PHYSICS_RENDER_STACK,
  physicsKernel: PHYSICS_KERNEL_ENGINE,
  importSpecifier: PHYSICS_KERNEL_IMPORT,
  updatePolicy: PHYSICS_UPDATE_POLICY,
  scenePolicy: HIGH_THROUGHPUT_SCENE_POLICY,
  mechanismAuthority: 'MotionSmith kinematics + fabrication constraints',
  contactAuthority: 'Rapier collider contact/friction solver',
  throughputTargets: PHYSICS_KERNEL_TARGETS
});

export interface RapierFrictionProbeOptions {
  frictionCoefficient?: number;
  restitution?: number;
  steps?: number;
  dt?: number;
  initialHeight?: number;
  radius?: number;
}

export interface RapierFrictionProbe {
  engine: typeof PHYSICS_KERNEL_ENGINE;
  initialized: true;
  rigidBodyCount: number;
  colliderCount: number;
  stepCount: number;
  dt: number;
  frictionCoefficient: number;
  restitution: number;
  settledY: number;
  finalSpeed: number;
  contactSettled: boolean;
}

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export const runRapierFrictionProbe = async (options: RapierFrictionProbeOptions = {}): Promise<RapierFrictionProbe> => {
  const RAPIER = await loadRapierPhysicsKernel();
  const frictionCoefficient = Math.max(0, finite(options.frictionCoefficient ?? 0.8, 0.8));
  const restitution = Math.max(0, finite(options.restitution ?? 0.02, 0.02));
  const steps = Math.max(1, Math.floor(finite(options.steps ?? 120, 120)));
  const dt = Math.max(1 / 240, Math.min(1 / 24, finite(options.dt ?? 1 / 60, 1 / 60)));
  const initialHeight = Math.max(0.5, finite(options.initialHeight ?? 1, 1));
  const radius = Math.max(0.05, finite(options.radius ?? 0.2, 0.2));
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.dt = dt;

  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(10, 0.1, 10)
      .setFriction(frictionCoefficient)
      .setRestitution(restitution),
    groundBody
  );

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, initialHeight, 0)
      .setLinvel(0.6, 0, 0)
      .setAngularDamping(0.2)
      .setLinearDamping(0.02)
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(radius)
      .setFriction(frictionCoefficient)
      .setRestitution(restitution),
    body
  );

  for (let step = 0; step < steps; step += 1) world.step();

  const translation = body.translation();
  const velocity = body.linvel();
  const finalSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const expectedCenterY = radius;
  world.free();

  return {
    engine: PHYSICS_KERNEL_ENGINE,
    initialized: true,
    rigidBodyCount: 2,
    colliderCount: 2,
    stepCount: steps,
    dt,
    frictionCoefficient,
    restitution,
    settledY: finite(translation.y, Number.NaN),
    finalSpeed: finite(finalSpeed, Number.POSITIVE_INFINITY),
    contactSettled: Math.abs(translation.y - expectedCenterY) < 0.14 && finalSpeed < 0.8
  };
};
