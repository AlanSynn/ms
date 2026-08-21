import assert from 'node:assert/strict';

import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import {
  buildBlueprintModel,
  createBlueprintPackage,
} from '../runtime/blueprint/BlueprintModel';
import { SCENE_PX_PER_MM } from '../utils/coordinates';
import { makeCustomPartsStl } from '../utils/fabricationCustomParts';
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
  partOutlineBounds,
  pointInsideOutline,
} from '../utils/partGeometry';

const project = createFabricationReadyFourBarProject();
const firstModel = buildBlueprintModel(project);
const secondModel = buildBlueprintModel(project);

assert.equal(
  firstModel,
  secondModel,
  'Blueprint reuses the exact model for an immutable ProjectState identity',
);
assert.equal(
  firstModel.recipes,
  secondModel.recipes,
  'Blueprint recipe preparation is reused across cached reads',
);

const firstPackage = createBlueprintPackage(project);
const secondPackage = createBlueprintPackage(project);
assert.equal(
  firstPackage,
  secondPackage,
  'Blueprint package preparation is reused for the same immutable project',
);
assert.equal(firstPackage.svg, secondPackage.svg, 'cached package SVG bytes remain exact');
assert.equal(
  firstPackage.cutSheetPdf,
  secondPackage.cutSheetPdf,
  'cached package PDF bytes remain exact',
);
assert.equal(firstPackage.customPartsStl, '', 'ordinary Blueprint packages leave optional STL generation on demand');

const customPartsStl = makeCustomPartsStl(project);
const vertices = [...customPartsStl.matchAll(/vertex ([^\n]+)/g)]
  .map((match) => match[1].trim());
const edgeUse = new Map<string, number>();
for (let index = 0; index < vertices.length; index += 3) {
  for (const [a, b] of [
    [vertices[index], vertices[index + 1]],
    [vertices[index + 1], vertices[index + 2]],
    [vertices[index + 2], vertices[index]],
  ]) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
  }
}
assert.equal(
  [...edgeUse.values()].filter((uses) => uses === 1).length,
  0,
  'compacted classroom STL has no open mesh edges',
);
const firstPart = project.parts[project.partOrder.find((id) => project.parts[id]?.visible)!];
assert(firstPart, 'fixture has a visible character plate');
const firstLandmarks = partLandmarkLocalPoints(firstPart, project.skeleton);
const firstOutline = fabricablePartOutlinePoints(firstPart, firstLandmarks);
const firstHole = firstLandmarks.find((point) =>
  pointInsideOutline(point, firstOutline, 0.5),
);
assert(firstHole, 'fixture has a joint hole in its first character plate');
const firstBounds = partOutlineBounds(firstOutline);
const holeMm = {
  x: (firstHole.x - firstBounds.minX) / SCENE_PX_PER_MM,
  y: (firstHole.y - firstBounds.minY) / SCENE_PX_PER_MM,
};
const pointInTriangle = (
  point: [number, number],
  triangle: Array<[number, number, number]>,
) => {
  const sign = (a: [number, number], b: [number, number], c: [number, number]) =>
    (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
  const vertices2d = triangle.map(([x, y]) => [x, y] as [number, number]);
  const signs = [
    sign(point, vertices2d[0], vertices2d[1]),
    sign(point, vertices2d[1], vertices2d[2]),
    sign(point, vertices2d[2], vertices2d[0]),
  ];
  return !(signs.some((value) => value < -1e-6) && signs.some((value) => value > 1e-6));
};
const numericTriangles = Array.from({ length: vertices.length / 3 }, (_, index) =>
  vertices.slice(index * 3, index * 3 + 3).map((vertex) =>
    vertex.split(/\s+/).map(Number) as [number, number, number],
  ),
);
assert.equal(
  numericTriangles.some((triangle) =>
    triangle.every((vertex) => Math.abs(vertex[2] - 2.4) < 1e-6) &&
    pointInTriangle([holeMm.x, holeMm.y], triangle),
  ),
  false,
  'compacted classroom STL keeps a physical void at a joint-hole center',
);
assert(vertices.length / 3 < 20_000, 'compacted classroom STL stays below 20k facets');
assert(
  Buffer.byteLength(customPartsStl) < 1_300_000,
  'compacted classroom STL stays below 1.3 MB without dropping plate or hole surfaces',
);

console.log('b695 Blueprint cache contract passed');
