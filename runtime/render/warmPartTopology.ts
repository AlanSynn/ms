import * as THREE from "three";

import type { PartTopologyPolicy } from "../../utils/renderPerformancePolicy";

const warmedPolicies = new Set<string>();

const policyKey = (policy: PartTopologyPolicy) => [
  policy.bevelEnabled ? 1 : 0,
  policy.edgeGeometryEnabled ? 1 : 0,
  policy.curveSegments,
].join(":");

export const warmPartTopologyPipeline = (policy: PartTopologyPolicy) => {
  const key = policyKey(policy);
  if (warmedPolicies.has(key)) return false;
  warmedPolicies.add(key);

  const shape = new THREE.Shape([
    new THREE.Vector2(-0.5, -0.35),
    new THREE.Vector2(0.5, -0.35),
    new THREE.Vector2(0.5, 0.35),
    new THREE.Vector2(-0.5, 0.35),
  ]);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 0.08, 0.08, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const plate = new THREE.ExtrudeGeometry(shape, {
    depth: 0.22,
    bevelEnabled: policy.bevelEnabled,
    bevelSegments: 1,
    curveSegments: policy.curveSegments,
    steps: 1,
  });
  const art = new THREE.ShapeGeometry(shape);
  const ring = new THREE.TorusGeometry(0.11, 0.014, 8, 28);
  const edges = policy.edgeGeometryEnabled
    ? new THREE.EdgesGeometry(plate)
    : undefined;
  edges?.dispose();
  ring.dispose();
  art.dispose();
  plate.dispose();
  return true;
};
