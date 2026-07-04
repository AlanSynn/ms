import * as THREE from "three";
import { WEBGL_PIXEL_RATIO_CAP } from "./viewport";

export const setRendererPixelRatioCap = (
  renderer: THREE.WebGLRenderer,
  cap = WEBGL_PIXEL_RATIO_CAP,
) => {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
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
