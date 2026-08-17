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

console.log('b695 Blueprint cache contract passed');
