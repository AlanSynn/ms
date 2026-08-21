import assert from 'node:assert/strict';

import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import {
  buildBlueprintModel,
  createBlueprintPackage,
} from '../runtime/blueprint/BlueprintModel';

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

const vertices = [...firstPackage.customPartsStl.matchAll(/vertex ([^\n]+)/g)]
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
assert(vertices.length / 3 < 20_000, 'compacted classroom STL stays below 20k facets');
assert(
  Buffer.byteLength(firstPackage.customPartsStl) < 2_500_000,
  'compacted classroom STL stays below 2.5 MB without dropping plate or hole surfaces',
);

console.log('b695 Blueprint cache contract passed');
