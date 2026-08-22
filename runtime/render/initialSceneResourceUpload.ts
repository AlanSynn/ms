import * as THREE from "three";

type ScissorRenderer = Pick<
  THREE.WebGLRenderer,
  "getScissor" | "getScissorTest" | "setScissor" | "setScissorTest"
>;

export type InitialSceneResourceUploadRenderer = ScissorRenderer;

export type InitialSceneReadinessFrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

export type InitialSceneReadinessGeneration = {
  invalidate: () => void;
  schedule: (validate: () => boolean) => boolean;
  cancel: () => void;
  hasScheduledPublication: () => boolean;
};

const browserReadinessFrameScheduler: InitialSceneReadinessFrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

/**
 * Publish initial-scene readiness only for the latest retained-scene
 * revision. Invalidation clears readiness immediately and makes even an
 * already-queued (or adversarially delivered) older frame harmless.
 */
export const createInitialSceneReadinessGeneration = ({
  onReadyChange,
  scheduler = browserReadinessFrameScheduler,
}: {
  onReadyChange: (ready: boolean) => void;
  scheduler?: InitialSceneReadinessFrameScheduler;
}): InitialSceneReadinessGeneration => {
  type ScheduledPublication = {
    readonly revision: number;
    handle?: number;
  };

  let revision = 0;
  let scheduled: ScheduledPublication | undefined;

  const invalidate = () => {
    revision += 1;
    const pending = scheduled;
    scheduled = undefined;
    if (pending?.handle !== undefined) scheduler.cancel(pending.handle);
    onReadyChange(false);
  };

  const schedule = (validate: () => boolean) => {
    if (scheduled) return false;
    const publication: ScheduledPublication = { revision };
    scheduled = publication;
    publication.handle = scheduler.request(() => {
      if (scheduled !== publication) return;
      scheduled = undefined;
      if (publication.revision !== revision || !validate()) return;
      onReadyChange(true);
    });
    return true;
  };

  return {
    invalidate,
    schedule,
    cancel: invalidate,
    hasScheduledPublication: () => scheduled !== undefined,
  };
};

type ObjectVisibility = {
  readonly object: THREE.Object3D;
  readonly visible: boolean;
  readonly frustumCulled: boolean;
};

/**
 * Realize every retained draw object in the selected roots before an initial
 * scene reports ready. The one-pixel warm submission cannot flash hidden
 * content; the immediately following canonical submission restores the exact
 * visible scene while retaining the uploaded buffers, VAOs, and textures.
 */
export const realizeInitialSceneResources = ({
  renderer,
  roots,
  submit,
}: {
  renderer: ScissorRenderer;
  roots: readonly THREE.Object3D[];
  submit: () => void;
}) => {
  const previousScissor = renderer.getScissor(new THREE.Vector4()).clone();
  const previousScissorTest = renderer.getScissorTest();
  const objects: ObjectVisibility[] = [];
  const materials = new Map<THREE.Material, boolean>();
  const visited = new Set<THREE.Object3D>();

  roots.forEach((root) => {
    root.traverse((object) => {
      if (visited.has(object)) return;
      visited.add(object);
      objects.push({
        object,
        visible: object.visible,
        frustumCulled: object.frustumCulled,
      });
      object.visible = true;
      object.frustumCulled = false;
      const material = (object as THREE.Mesh).material;
      const objectMaterials = Array.isArray(material)
        ? material
        : material
          ? [material]
          : [];
      objectMaterials.forEach((candidate) => {
        if (!materials.has(candidate)) materials.set(candidate, candidate.visible);
        candidate.visible = true;
      });
    });
  });

  try {
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 1, 1);
    submit();
  } finally {
    objects.forEach(({ object, visible, frustumCulled }) => {
      object.visible = visible;
      object.frustumCulled = frustumCulled;
    });
    materials.forEach((visible, material) => {
      material.visible = visible;
    });
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
  }

  submit();
};
