import * as THREE from "three";

export type FoundryAssemblyFramePresentation = {
  zGuideExtension: number;
  automataLift: number;
  travelProgress: number;
};

export type FoundryAssemblyZGuideBinding = {
  object: THREE.Object3D;
  baseHeight: number;
  basePositionZ: number;
  baseScaleY: number;
};

export type FoundryAssemblyTravelLineBinding = {
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type FoundryAssemblyFrameBindings = {
  readonly zGuides: FoundryAssemblyZGuideBinding[];
  readonly travelLines: FoundryAssemblyTravelLineBinding[];
};

const geometryFor = (object: THREE.Object3D) =>
  "geometry" in object ? (object as THREE.Mesh).geometry : undefined;

const positionAttributeFor = (object: THREE.Object3D) => {
  const position = geometryFor(object)?.getAttribute("position");
  return position && position.count >= 2 ? position : undefined;
};

export const createFoundryAssemblyFrameBindings = (): FoundryAssemblyFrameBindings => ({
  zGuides: [],
  travelLines: [],
});

/** Capture named overlay objects from the table's one structural traversal. */
export const captureFoundryAssemblyFrameBinding = (
  object: THREE.Object3D,
  bindings: FoundryAssemblyFrameBindings,
) => {
  if (
    object.name === "assembly-z-guide" &&
    object.userData.assemblyGuideBinding === "explode"
  ) {
    const geometry = geometryFor(object);
    geometry?.computeBoundingBox();
    const bounds = geometry?.boundingBox;
    bindings.zGuides.push({
      object,
      baseHeight: Math.max(0.001, (bounds?.max.y ?? 1) - (bounds?.min.y ?? 0)),
      basePositionZ: object.position.z,
      baseScaleY: object.scale.y,
    });
    return;
  }
  if (object.name !== "assembly-travel-line") return;
  const position = positionAttributeFor(object);
  if (!position) return;
  bindings.travelLines.push({
    position,
    startX: position.getX(0),
    startY: position.getY(0),
    endX: position.getX(1),
    endY: position.getY(1),
  });
};

export const updateFoundryAssemblyFrameBindings = (
  bindings: FoundryAssemblyFrameBindings,
  presentation: FoundryAssemblyFramePresentation,
) => {
  const extension = Math.max(0, presentation.zGuideExtension);
  for (const guide of bindings.zGuides) {
    guide.object.scale.y = guide.baseScaleY
      * (guide.baseHeight + extension)
      / guide.baseHeight;
    guide.object.position.z = guide.basePositionZ + extension / 2;
  }
  const travelProgress = Math.max(0, Math.min(1, presentation.travelProgress));
  for (const line of bindings.travelLines) {
    line.position.setX(
      0,
      line.startX + (line.endX - line.startX) * travelProgress,
    );
    line.position.setY(
      0,
      line.startY + (line.endY - line.startY) * travelProgress,
    );
    line.position.needsUpdate = true;
  }
};
