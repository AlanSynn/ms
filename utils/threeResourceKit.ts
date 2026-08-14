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
  disposedGeometries?: Set<THREE.BufferGeometry>;
  disposedMaterials?: Set<THREE.Material>;
  disposedTextures?: Set<THREE.Texture>;
};

const MATERIAL_TEXTURE_KEYS = [
  "alphaMap",
  "aoMap",
  "anisotropyMap",
  "bumpMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "gradientMap",
  "iridescenceMap",
  "iridescenceThicknessMap",
  "lightMap",
  "map",
  "matcap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "specularColorMap",
  "specularIntensityMap",
  "specularMap",
  "thicknessMap",
  "transmissionMap",
] as const;

const disposeThreeGeometry = (
  geometry: THREE.BufferGeometry,
  disposedGeometries = new Set<THREE.BufferGeometry>(),
) => {
  if (disposedGeometries.has(geometry)) return;
  disposedGeometries.add(geometry);
  geometry.dispose();
};

const disposeThreeMaterial = (
  material: THREE.Material,
  disposedMaterials = new Set<THREE.Material>(),
  disposedTextures = new Set<THREE.Texture>(),
) => {
  if (disposedMaterials.has(material)) return;
  disposedMaterials.add(material);
  const textureMaterial = material as THREE.Material &
    Partial<Record<(typeof MATERIAL_TEXTURE_KEYS)[number], THREE.Texture | null>>;
  MATERIAL_TEXTURE_KEYS.forEach((key) => {
    const texture = textureMaterial[key];
    if (!texture || disposedTextures.has(texture)) return;
    disposedTextures.add(texture);
    texture.dispose();
  });
  material.dispose();
};

export const disposeThreeObjectGraph = (
  object: THREE.Object3D,
  {
    disposeMaterials = true,
    keepGeometry,
    keepMaterial,
    beforeDisposeMaterial,
    disposedGeometries = new Set<THREE.BufferGeometry>(),
    disposedMaterials = new Set<THREE.Material>(),
    disposedTextures = new Set<THREE.Texture>(),
  }: DisposeObjectOptions = {},
) =>
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry && !keepGeometry?.(mesh.geometry, child))
      disposeThreeGeometry(mesh.geometry, disposedGeometries);
    if (!disposeMaterials) return;
    const material = mesh.material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    materials.forEach((item) => {
      if (keepMaterial?.(item, child)) return;
      if (disposedMaterials.has(item)) return;
      beforeDisposeMaterial?.(item, child);
      disposeThreeMaterial(item, disposedMaterials, disposedTextures);
    });
  });

export const disposeThreeResourceCaches = (
  geometryCache: Map<string, THREE.BufferGeometry>,
  materialCache: Map<string, THREE.Material>,
) => {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();
  geometryCache.forEach((geometry) =>
    disposeThreeGeometry(geometry, disposedGeometries),
  );
  materialCache.forEach((material) =>
    disposeThreeMaterial(material, disposedMaterials, disposedTextures),
  );
  geometryCache.clear();
  materialCache.clear();
};

export const disposeMarkedThreeMaterials = (
  object: THREE.Object3D,
  isOwned: (material: THREE.Material) => boolean,
) => {
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    materials.forEach((item) => {
      if (!isOwned(item) || disposedMaterials.has(item)) return;
      disposeThreeMaterial(item, disposedMaterials, disposedTextures);
    });
  });
};

export const clearThreeGroup = (
  group: THREE.Group,
  disposeChild: (child: THREE.Object3D) => void,
) => {
  [...group.children].forEach((child) => {
    group.remove(child);
    disposeChild(child);
  });
};
