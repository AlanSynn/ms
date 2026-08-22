import * as THREE from "three";

import { disposePartArtMaterial } from "./partArtMaterial";
import { disposeThreeObjectGraph } from "../../utils/threeResourceKit";

const isPuppetOwnedMaterial = (material: THREE.Material) =>
  material.userData.ownedByPartArt === true ||
  material.userData.ownedBySceneObject === true;

const disposePuppetOwnedMaterialResources = (material: THREE.Material) => {
  if (!isPuppetOwnedMaterial(material)) return;
  if (material.userData.ownedByPartArt === true) {
    disposePartArtMaterial(material);
    return;
  }

  material.userData.sceneObjectDisposed = true;
  material.userData.initialSceneResourcePending = false;
  (material as THREE.MeshBasicMaterial).map?.dispose();
};

/**
 * Release one Puppet scene subtree with one Object3D traversal. Decal and
 * scene-object materials are preview-owned; shared fabrication geometry and
 * the caller-owned material kit remain available for the next renderer lease.
 */
export const disposePuppetObjectGraph = (object: THREE.Object3D) =>
  disposeThreeObjectGraph(object, {
    keepGeometry: (geometry) =>
      geometry.userData.sharedFabricationGeometry === true,
    keepMaterial: (material) => !isPuppetOwnedMaterial(material),
    beforeDisposeMaterial: disposePuppetOwnedMaterialResources,
  });
