import * as THREE from "three";
import {
  effectiveRenderPixelRatio,
  RENDER_VIEWPORT_PIXEL_BUDGET,
  type RenderPerformancePolicy,
} from "./renderPerformancePolicy";

type SharedRendererSlot = {
  renderer: THREE.WebGLRenderer;
  leased: boolean;
};

export type SharedWebGLRendererLease = {
  renderer: THREE.WebGLRenderer;
  release: () => void;
};

const sharedRendererSlots = new Map<string, SharedRendererSlot[]>();

/**
 * Keep the browser's WebGL context alive while stage-owned scenes come and go.
 * Geometry, materials, textures, and scene references remain owned by each
 * preview and are still disposed by that preview before releasing the lease.
 */
export const acquireSharedWebGLRenderer = ({
  antialias,
  alpha,
}: Pick<THREE.WebGLRendererParameters, "antialias" | "alpha">): SharedWebGLRendererLease => {
  const key = `${antialias ? "aa" : "no-aa"}:${alpha ? "alpha" : "opaque"}`;
  const slots = sharedRendererSlots.get(key) ?? [];
  sharedRendererSlots.set(key, slots);
  let slot = slots.find((candidate) =>
    !candidate.leased && !candidate.renderer.getContext().isContextLost()
  );
  if (!slot) {
    slot = {
      renderer: new THREE.WebGLRenderer({ antialias, alpha }),
      leased: false,
    };
    slots.push(slot);
  }
  slot.leased = true;
  const renderer = slot.renderer;
  let released = false;
  return {
    renderer,
    release: () => {
      if (released) return;
      released = true;
      renderer.setAnimationLoop(null);
      renderer.setRenderTarget(null);
      renderer.renderLists.dispose();
      renderer.info.reset();
      renderer.resetState();
      renderer.setSize(1, 1, false);
      slot.leased = false;
    },
  };
};

const rendererLogicalSize = new THREE.Vector2();

export const resizeRendererToPerformancePolicy = (
  renderer: THREE.WebGLRenderer,
  policy: Pick<RenderPerformancePolicy, "pixelRatioCap">,
  viewport: { width: number; height: number },
) => {
  let reportedRenderbufferLimit = Number.NaN;
  try {
    const context = renderer.getContext();
    reportedRenderbufferLimit = Number(
      context.getParameter(context.MAX_RENDERBUFFER_SIZE),
    );
  } catch {
    // A lost context or lightweight test double may not expose parameters.
  }
  const textureLimit = Number(renderer.capabilities?.maxTextureSize);
  const fallbackRenderbufferLimit =
    Number.isFinite(textureLimit) && textureLimit > 0
      ? Math.min(textureLimit, 4096)
      : 4096;
  const ratio = effectiveRenderPixelRatio({
    policy,
    devicePixelRatio:
      typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    maxRenderbufferDimension:
      Number.isFinite(reportedRenderbufferLimit) && reportedRenderbufferLimit > 0
        ? reportedRenderbufferLimit
        : fallbackRenderbufferLimit,
  });
  const currentSize = renderer.getSize(rendererLogicalSize);
  if (
    currentSize.x !== viewport.width ||
    currentSize.y !== viewport.height ||
    renderer.getPixelRatio() !== ratio
  ) {
    const targetDrawingBufferWidth = Math.floor(viewport.width * ratio);
    const currentDrawingBufferHeight = Number(renderer.domElement?.height);
    if (
      Number.isFinite(currentDrawingBufferHeight) &&
      currentDrawingBufferHeight > 0 &&
      targetDrawingBufferWidth * currentDrawingBufferHeight >
        RENDER_VIEWPORT_PIXEL_BUDGET
    ) {
      // Three updates canvas.width before canvas.height. Reset a pathological
      // portrait/landscape cross-product first so even that intermediate
      // browser allocation stays inside the classroom pixel budget.
      renderer.setDrawingBufferSize(1, 1, 1);
    }
    // Apply logical size and DPR through one Three API call. Calling
    // setPixelRatio before setSize can resize the previous large viewport at a
    // newly raised DPR, briefly exceeding the backing-store pixel budget.
    renderer.setDrawingBufferSize(viewport.width, viewport.height, ratio);
  }
  return ratio;
};

export const cachedThreeResource = <
  Base extends { userData: Record<string, unknown> },
  Resource extends Base,
>(
  cache: Map<string, Base>,
  key: string,
  create: () => Resource,
  markerKey: string,
): Resource => {
  const existing = cache.get(key);
  if (existing) return existing as Resource;
  const resource = create();
  resource.userData[markerKey] = true;
  cache.set(key, resource);
  return resource;
};

type DisposeObjectOptions = {
  disposeMaterials?: boolean;
  keepGeometry?: (
    geometry: THREE.BufferGeometry,
    owner: THREE.Object3D,
  ) => boolean;
  keepMaterial?: (material: THREE.Material, owner: THREE.Object3D) => boolean;
  beforeDisposeMaterial?: (
    material: THREE.Material,
    owner: THREE.Object3D,
  ) => void;
};

export const disposeThreeObjectGraph = (
  object: THREE.Object3D,
  {
    disposeMaterials = true,
    keepGeometry,
    keepMaterial,
    beforeDisposeMaterial,
  }: DisposeObjectOptions = {},
) =>
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      (child as THREE.InstancedMesh).dispose();
    }
    if (mesh.geometry && !keepGeometry?.(mesh.geometry, child))
      mesh.geometry.dispose();
    if (!disposeMaterials) return;
    const material = mesh.material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    materials.forEach((item) => {
      beforeDisposeMaterial?.(item, child);
      if (!keepMaterial?.(item, child)) item.dispose();
    });
  });

export const disposeMarkedThreeMaterials = (
  object: THREE.Object3D,
  isOwned: (material: THREE.Material) => boolean,
  beforeDispose?: (material: THREE.Material) => void,
) =>
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    materials.forEach((item) => {
      if (!isOwned(item)) return;
      beforeDispose?.(item);
      item.dispose();
    });
  });

export const clearThreeGroup = (
  group: THREE.Group,
  disposeChild: (child: THREE.Object3D) => void,
) => {
  [...group.children].forEach((child) => {
    group.remove(child);
    disposeChild(child);
  });
};

export type ThreeObjectResourceUsage = {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
};

export const collectThreeObjectResourceUsage = (
  root: THREE.Object3D,
): ThreeObjectResourceUsage => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry) geometries.add(geometry);
    const material = (object as THREE.Mesh).material;
    const entries = Array.isArray(material)
      ? material
      : material
        ? [material]
        : [];
    entries.forEach((entry) => materials.add(entry));
  });
  return { geometries, materials };
};

export const pruneUnusedThreeResourceCache = <Resource extends { dispose: () => void }>(
  cache: Map<string, Resource>,
  used: ReadonlySet<Resource>,
  maxEntries: number,
) => {
  let removed = 0;
  const limit = Math.max(0, Math.floor(maxEntries));
  if (cache.size <= limit) return removed;
  for (const [key, resource] of cache) {
    if (cache.size <= limit) break;
    if (used.has(resource)) continue;
    resource.dispose();
    cache.delete(key);
    removed += 1;
  }
  return removed;
};
