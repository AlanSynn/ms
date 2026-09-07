import * as THREE from "three";

import type { BodyPartLayer, Bounds, Point, SceneObject } from "../../types";
import { artworkOwnerFrame } from "../../utils/artwork";

export type ArtworkSurfaceOwner = Pick<BodyPartLayer | SceneObject,
  "id" | "bounds" | "artwork" | "textureUrl" | "fillColor" | "opacity"
>;

/** The raster crop may change; retained marks and source-image frames never do. */
export const artworkSurfaceFrame = (
  owner: ArtworkSurfaceOwner,
  outline: readonly Point[],
): Bounds => {
  if (!owner.artwork || outline.length < 3) return artworkOwnerFrame(owner);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  outline.forEach(({ x, y }) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  });
  return { x: minX, y: minY, width: Math.max(1e-6, maxX - minX), height: Math.max(1e-6, maxY - minY) };
};

export const artworkSurfaceFrameKey = (frame: Bounds) =>
  [frame.x, frame.y, frame.width, frame.height].join(":");

/** Canvas is Y-down, local geometry Y-up. Three flips the canvas upload once. */
export const mapArtworkSurfaceUvs = (
  geometry: THREE.BufferGeometry,
  frame: Bounds,
  positionToLocal: (x: number, y: number) => Point,
  legacyFlipY = false,
) => {
  const positions = geometry.getAttribute("position");
  const uvs: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    const local = positionToLocal(positions.getX(index), positions.getY(index));
    const v = (local.y - frame.y) / frame.height;
    uvs.push((local.x - frame.x) / frame.width, legacyFlipY ? 1 - v : v);
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
};

/** Retain an unaffected owner's mesh/material even when another owner changes. */
export const retainArtworkGroup = (
  root: THREE.Group,
  name: string,
  geometryKey: string,
  dispose: (object: THREE.Object3D) => void,
): THREE.Group | undefined => {
  const existing = root.getObjectByName(name) as THREE.Group | undefined;
  if (!existing) return undefined;
  if (existing.userData.geometryKey === geometryKey) return existing;
  existing.removeFromParent();
  dispose(existing);
  return undefined;
};

/** Called only by opt-in browser diagnostics, after the shared scene renders. */
export const collectArtworkSurfaceState = (root: THREE.Object3D) => {
  const surfaces: Array<{
    ownerId: string; ownerKind: string; revision: string; installedRevision?: string;
    status: string; materialId: string; textureId?: string; geometryId: string;
    width: number; height: number;
  }> = [];
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    const material = mesh.material as THREE.MeshBasicMaterial | undefined;
    if (!material?.userData?.ownedByPartArt || !material.userData.partArtOwnerId) return;
    const data = material.userData;
    const texture = material.map;
    const image = texture?.image as { width?: number; height?: number } | undefined;
    surfaces.push({
      ownerId: data.partArtOwnerId,
      ownerKind: object.userData.sceneObjectId ? "object" : "part",
      revision: data.partArtRevision,
      installedRevision: data.partArtInstalledRevision,
      status: data.partArtError ? "failed" : data.initialSceneResourcePending ? "pending" : "current",
      materialId: material.uuid, textureId: texture?.uuid, geometryId: mesh.geometry.uuid,
      width: image?.width ?? 0, height: image?.height ?? 0,
    });
  });
  return surfaces.sort((a, b) => `${a.ownerKind}:${a.ownerId}`.localeCompare(`${b.ownerKind}:${b.ownerId}`));
};
