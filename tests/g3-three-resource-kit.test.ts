import { strict as assert } from "node:assert";
import * as THREE from "three";
import {
  disposeMarkedThreeMaterials,
  disposeThreeObjectGraph,
  disposeThreeResourceCaches,
} from "../utils/threeResourceKit";

const textureFields = [
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

const test = (name: string, fn: () => void) => {
  fn();
  console.log(`ok - ${name}`);
};

test("shared geometry/material/texture resources dispose exactly once", () => {
  const root = new THREE.Group();
  const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sharedMaterial = new THREE.MeshPhysicalMaterial();
  const secondMaterial = new THREE.MeshPhysicalMaterial();
  const sharedTexture = new THREE.Texture();
  const textureDisposals = new Map<string, number>();
  const recordTexture = (field: string, texture: THREE.Texture) => {
    texture.addEventListener("dispose", () => {
      textureDisposals.set(field, (textureDisposals.get(field) ?? 0) + 1);
    });
    return texture;
  };
  const materialFields = sharedMaterial as unknown as Record<string, THREE.Texture | null>;
  const secondMaterialFields = secondMaterial as unknown as Record<string, THREE.Texture | null>;
  textureFields.forEach((field) => {
    const texture = field === "map"
      ? sharedTexture
      : recordTexture(field, new THREE.Texture());
    materialFields[field] = texture;
  });
  secondMaterialFields.map = sharedTexture;
  sharedTexture.addEventListener("dispose", () => {
    textureDisposals.set("map", (textureDisposals.get("map") ?? 0) + 1);
  });
  let geometryDisposals = 0;
  let sharedMaterialDisposals = 0;
  let secondMaterialDisposals = 0;
  sharedGeometry.addEventListener("dispose", () => {
    geometryDisposals += 1;
  });
  sharedMaterial.addEventListener("dispose", () => {
    sharedMaterialDisposals += 1;
  });
  secondMaterial.addEventListener("dispose", () => {
    secondMaterialDisposals += 1;
  });
  root.add(
    new THREE.Mesh(sharedGeometry, sharedMaterial),
    new THREE.Mesh(sharedGeometry, sharedMaterial),
    new THREE.Mesh(sharedGeometry, secondMaterial),
  );

  disposeThreeObjectGraph(root);

  assert.equal(geometryDisposals, 1);
  assert.equal(sharedMaterialDisposals, 1);
  assert.equal(secondMaterialDisposals, 1);
  textureFields.forEach((field) => {
    assert.equal(
      textureDisposals.get(field),
      1,
      `${field} is disposed exactly once`,
    );
  });
});

test("Foundry cache teardown deduplicates resources and clears every cache", () => {
  const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sharedMaterial = new THREE.MeshBasicMaterial();
  const sharedTexture = new THREE.Texture();
  sharedMaterial.map = sharedTexture;
  const geometryDisposals = { count: 0 };
  const materialDisposals = { count: 0 };
  const textureDisposals = { count: 0 };
  sharedGeometry.addEventListener("dispose", () => geometryDisposals.count += 1);
  sharedMaterial.addEventListener("dispose", () => materialDisposals.count += 1);
  sharedTexture.addEventListener("dispose", () => textureDisposals.count += 1);
  const geometryCache = new Map([
    ["bar:first", sharedGeometry],
    ["bar:duplicate", sharedGeometry],
  ]);
  const materialCache = new Map([
    ["material:first", sharedMaterial],
    ["material:duplicate", sharedMaterial],
  ]);

  disposeThreeResourceCaches(geometryCache, materialCache);

  assert.equal(geometryDisposals.count, 1);
  assert.equal(materialDisposals.count, 1);
  assert.equal(textureDisposals.count, 1);
  assert.equal(geometryCache.size, 0);
  assert.equal(materialCache.size, 0);
  disposeThreeResourceCaches(new Map(), new Map());
});

test("owned material teardown deduplicates shared materials and maps", () => {
  const root = new THREE.Group();
  const sharedMaterial = new THREE.MeshBasicMaterial();
  const sharedTexture = new THREE.Texture();
  sharedMaterial.map = sharedTexture;
  sharedMaterial.userData.ownedBySceneObject = true;
  const secondMaterial = new THREE.MeshBasicMaterial();
  secondMaterial.map = sharedTexture;
  secondMaterial.userData.ownedBySceneObject = true;
  let sharedMaterialDisposals = 0;
  let secondMaterialDisposals = 0;
  let textureDisposals = 0;
  sharedMaterial.addEventListener("dispose", () => sharedMaterialDisposals += 1);
  secondMaterial.addEventListener("dispose", () => secondMaterialDisposals += 1);
  sharedTexture.addEventListener("dispose", () => textureDisposals += 1);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  root.add(
    new THREE.Mesh(geometry, sharedMaterial),
    new THREE.Mesh(geometry, sharedMaterial),
    new THREE.Mesh(geometry, secondMaterial),
  );

  disposeMarkedThreeMaterials(
    root,
    (material) => Boolean(material.userData.ownedBySceneObject),
  );

  assert.equal(sharedMaterialDisposals, 1);
  assert.equal(secondMaterialDisposals, 1);
  assert.equal(textureDisposals, 1);
});

console.log("g3 Three resource disposal contracts passed");
