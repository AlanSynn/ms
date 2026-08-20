import * as THREE from 'three';

import type { PathGestureDraftSnapshot } from '../../../runtime/path/pathGestureDraft';
import { sampleIndexedValues } from '../../../utils/interactiveSampling';

type ThreePathGestureDraftVisualOptions = {
  parent: THREE.Group;
  lineMaterial: THREE.Material;
  markerGeometry: THREE.BufferGeometry;
  markerMaterial: THREE.Material;
  maxLinePoints: number;
  maxHandles: number;
  viewScale: number;
};

export const createThreePathGestureDraftVisual = ({
  parent,
  lineMaterial,
  markerGeometry,
  markerMaterial,
  maxLinePoints,
  maxHandles,
  viewScale,
}: ThreePathGestureDraftVisualOptions) => {
  const linePositions = new THREE.BufferAttribute(
    new Float32Array(Math.max(3, maxLinePoints + 1) * 3),
    3,
  );
  linePositions.setUsage(THREE.DynamicDrawUsage);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', linePositions);
  lineGeometry.setDrawRange(0, 0);
  const line = new THREE.Line(lineGeometry, lineMaterial);
  line.name = 'path-gesture-draft-line';
  line.renderOrder = 94;
  line.frustumCulled = false;

  const markers = new THREE.InstancedMesh(
    markerGeometry,
    markerMaterial,
    Math.max(1, maxHandles),
  );
  markers.name = 'path-gesture-draft-points';
  markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  markers.count = 0;
  markers.renderOrder = 95;
  markers.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'path-gesture-draft';
  group.visible = false;
  group.add(line, markers);
  parent.add(group);
  const markerTransform = new THREE.Object3D();

  const apply = (snapshot: PathGestureDraftSnapshot | null) => {
    if (!snapshot) {
      lineGeometry.setDrawRange(0, 0);
      markers.count = 0;
      group.visible = false;
      return;
    }
    const protectedIndexes = snapshot.selectedPointIndex == null
      ? []
      : [snapshot.selectedPointIndex];
    const lineSamples = sampleIndexedValues(
      snapshot.points,
      maxLinePoints,
      protectedIndexes,
    );
    const handleSamples = sampleIndexedValues(
      snapshot.points,
      maxHandles,
      protectedIndexes,
    );
    const linePointCount = lineSamples.length + (
      snapshot.closed && lineSamples.length > 2 ? 1 : 0
    );
    lineSamples.forEach(({ value }, index) => {
      linePositions.setXYZ(index, value.x / viewScale, value.y / viewScale, 0.9);
    });
    if (linePointCount > lineSamples.length && lineSamples[0]) {
      const first = lineSamples[0].value;
      linePositions.setXYZ(
        linePointCount - 1,
        first.x / viewScale,
        first.y / viewScale,
        0.9,
      );
    }
    lineGeometry.setDrawRange(0, linePointCount);
    linePositions.needsUpdate = true;
    line.userData.pathId = snapshot.pathId;

    markers.userData.pathId = snapshot.pathId;
    markers.userData.pathPointIndices = handleSamples.map(({ index }) => index);
    handleSamples.forEach(({ value, index }, instanceIndex) => {
      const startScale = index === 0 ? 0.115 / 0.075 : 1;
      const selectedScale = index === snapshot.selectedPointIndex ? 1.45 : 1;
      markerTransform.position.set(
        value.x / viewScale,
        value.y / viewScale,
        0.94,
      );
      markerTransform.scale.setScalar(startScale * selectedScale);
      markerTransform.updateMatrix();
      markers.setMatrixAt(instanceIndex, markerTransform.matrix);
    });
    markers.count = handleSamples.length;
    markers.instanceMatrix.needsUpdate = true;
    group.visible = snapshot.points.length > 0;
  };

  return { group, apply };
};

export type ThreePathGestureDraftVisual = ReturnType<
  typeof createThreePathGestureDraftVisual
>;
