import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createEmptyProject, createSampleProject } from '../utils/project';
import { buildCharacterBuildSectionV1 } from '../utils/buildPlanCharacter';
import { characterPinPlan, type CharacterPin } from '../utils/characterPinPlan';

const sample = createSampleProject();
const varied = structuredClone(sample);
varied.parts.left_arm_lower.visible = false;
varied.parts.head.transform = { x: 48, y: 166, scale: 1.4, rotation: 23 };
varied.skeleton!.joints.neck.locked = true;
varied.skeleton!.joints.neck.position = { x: 840, y: -640 };
varied.skeleton!.rootJointIds = ['left_shoulder', 'hip'];
varied.settings.physicalKit.boardCells = 12;
varied.partOrder = [...varied.partOrder].reverse();
const single = structuredClone(sample);
single.partOrder = ['head'];
single.skeleton!.rootJointIds = ['neck'];
const fixtures = { empty: createEmptyProject(), sample, varied, single,
  noSkeleton: { ...sample, skeleton: null } };
const hashes = Object.fromEntries(Object.entries(fixtures).map(([name, project]) => [name,
  createHash('sha256').update(JSON.stringify(buildCharacterBuildSectionV1(project))).digest('hex'),
]));
// Captured before extracting the canonical pin projection. The complete build
// section must retain pin order, world coordinates, stacks, art, and step refs.
const expectedHashes = {
  empty: ['33fa7d046760cd91ccfd3c878253bf06833067839a35d0f4d94aff03ade47b00'],
  sample: [
    '70a837c432f20ad2276bb3a9f16c24508f4059317daa570e70bd8b07d2e12b78',
    '4af97ae476e4d76f2f5d7828cabf209af06809a9c27e348b24f16f555aa862a0',
  ],
  varied: [
    'b2551d5952da4a819cf5a00fe982cfda765fc81a87d3f110f5cf3f742b6ac610',
    '3b48decd3913dc69c3dbcef4e245eef21a62a0e8158e08fdd66b8c688a701e99',
  ],
  single: ['4a96d7e2a3f32a21e98972d1ceaa24b22649caaa00ec6b1e494fd6d6951e095e'],
  noSkeleton: ['33fa7d046760cd91ccfd3c878253bf06833067839a35d0f4d94aff03ade47b00'],
};
for (const [name, actual] of Object.entries(hashes)) {
  assert(
    expectedHashes[name as keyof typeof expectedHashes].includes(actual),
    `build section hash for ${name} must match known canonical fixture`,
  );
}
for (const project of Object.values(fixtures)) {
  const { fixedPins, freePivots } = characterPinPlan(project);
  const { character } = buildCharacterBuildSectionV1(project);
  const physicalPin = ({ jointId, scene, partIds, partNames }: CharacterPin) => ({ jointId, scene, partIds, partNames });
  assert.deepEqual({ fixedPins, freePivots }, { fixedPins: character.fixedPins.map(physicalPin), freePivots: character.freePivots.map(physicalPin) });
}
console.log('canonical character pin extraction preserves complete build sections');
