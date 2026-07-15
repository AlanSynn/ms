import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConnectionSelectionRole, MechanismType } from '../types';
import {
  FABRICATION_BOARD_MOUNT_SPECS,
  FABRICATION_MODULE_SPECS,
  FABRICATION_REFERENCE_BOARD_MOUNT_PLACEMENTS,
  fabricationReferenceBoardMountHoleIds,
  HISTORIC_V1_CAM_GUIDE_BOARD_HOLES,
} from '../utils/fabricationContract';
import {
  CONNECTION_SELECTION_ROLE_POLICIES,
  connectionSelectionRolesForMechanism,
  normalizeMechanismConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import { isReferenceFoundryVisible, referenceRecipeForType } from '../utils/mechanismReference';
import {
  createDefaultMechanism,
  createEmptyProject,
  loadProjectSnapshot,
  serializeProject,
} from '../utils/project';
import { readAutosaveProject, STORAGE_KEYS } from '../utils/projectPersistence';

const root = process.cwd();
const source = (...segments: string[]) => join(root, 'scripts', 'fabrication', 'source', ...segments);
const fabrication = (...segments: string[]) => join(root, 'fabrication', ...segments);
const read = (path: string) => readFileSync(path, 'utf8');
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type SvgHole = { index: number; id?: string; x: number; y: number };

const svgHoles = (svg: string): SvgHole[] =>
  [...svg.matchAll(/<circle\b[^>]*data-hole-index="[^"]+"[^>]*\/?\s*>/g)].map(([tag]) => {
    const attribute = (name: string) => tag.match(new RegExp(`${name}="([^"]+)"`))?.[1];
    const index = Number(attribute('data-hole-index'));
    const x = Number(attribute('cx'));
    const y = Number(attribute('cy'));
    assert(Number.isInteger(index) && Number.isFinite(x) && Number.isFinite(y), `valid source hole ${tag}`);
    const id = attribute('data-hole-id');
    return { index, ...(id ? { id } : {}), x, y };
  }).sort((left, right) => left.index - right.index);

const guideSource = read(source('cam_modules', 'u-channel-guide-cartridge.svg'));
assert.deepEqual(svgHoles(guideSource), [
  { index: 0, x: 27, y: 20 },
  { index: 1, x: 27, y: 60 },
], 'the cam guide source has the approved 40 mm two-hole vector');

const camMount = FABRICATION_BOARD_MOUNT_SPECS.find((spec) => spec.key === 'cam-guide-2-hole');
assert(camMount, 'cam board mount inventory exists');
assert.deepEqual(camMount.sourceHoleIndices, [0, 1]);
assert.deepEqual(camMount.sourceHoleCentersMm, [{ x: 27, y: 20 }, { x: 27, y: 60 }]);
assert.deepEqual(camMount.orderedDeltasMm, [{ x: 0, y: 40 }]);
assert.equal(camMount.gridPitchCount, 2);
assert.deepEqual(fabricationReferenceBoardMountHoleIds('cam-guide-2-hole'), ['J11', 'J9']);
assert.deepEqual(HISTORIC_V1_CAM_GUIDE_BOARD_HOLES, ['J11', 'J9'], 'the historical v1 label pair remains evidence only');

const pistonMount = FABRICATION_BOARD_MOUNT_SPECS.find((spec) => spec.key === 'piston-guide-3-hole');
assert(pistonMount, 'piston board mount inventory exists');
assert.deepEqual(pistonMount.sourceHoleCentersMm, [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 50, y: 10 }]);
assert.deepEqual(pistonMount.orderedDeltasMm, [{ x: 20, y: 0 }, { x: 40, y: 0 }]);
assert.deepEqual(fabricationReferenceBoardMountHoleIds('piston-guide-3-hole'), ['G11', 'G12', 'G13']);
assert.deepEqual(
  FABRICATION_REFERENCE_BOARD_MOUNT_PLACEMENTS.find((placement) => placement.mountKey === 'piston-guide-3-hole'),
  {
    mountKey: 'piston-guide-3-hole',
    anchor: { col: 6, row: 10 },
    boardPitchDirection: { col: 0, row: 1 },
    rotationQuarterTurns: 1,
  },
  'the horizontal source piston guide keeps its explicit rotated board placement',
);

const legacyFollower = read(source('cam_modules', 'gravity-follower-module.svg'));
assert.deepEqual(svgHoles(legacyFollower), [{ index: 0, x: 19, y: 16 }], 'the v1 follower is preserved as one-hole evidence');
const v2Follower = read(source('cam_modules', 'gravity-follower-module-v2.svg'));
assert.match(v2Follower, /data-inventory-version="2"/);
assert.deepEqual(svgHoles(v2Follower), [
  { index: 0, id: 'output-0', x: 19, y: 16 },
  { index: 1, id: 'output-1', x: 19, y: 46 },
  { index: 2, id: 'output-2', x: 19, y: 76 },
], 'v2 follower has three named, real drill holes');
assert.deepEqual(FABRICATION_MODULE_SPECS, [{
  key: 'gravity-follower-module-v2',
  partKey: 'cam_modules:gravity-follower-module-v2',
  path: 'cam_modules/gravity-follower-module-v2.svg',
  version: 2,
  holes: {
    'output-0': { x: 19, y: 16 },
    'output-1': { x: 19, y: 46 },
    'output-2': { x: 19, y: 76 },
  },
}]);

const l4 = svgHoles(read(source('linkages', 'linkage-4-cell.svg')));
assert.equal(l4.length, 5, 'the planetary carrier source has five L4 holes');
assert.deepEqual(l4.map((hole) => hole.index), [0, 1, 2, 3, 4]);
assert.equal(isReferenceFoundryVisible('piston'), true, 'piston is available in Foundry');
assert(referenceRecipeForType('planetary_gear').requiredParts.some((part) => part.part === 'linkages:linkage-4-cell'));
assert(referenceRecipeForType('planetary_gear').stackLabels.includes('L4 carrier linkage'));

const expectedPolicies = {
  '4bar.input-joint': { mechanismType: '4bar', kind: 'linkage-hole', sourceNode: 'input-link', partKey: 'linkages:linkage-2-cell' },
  '4bar.output-joint': { mechanismType: '4bar', kind: 'linkage-hole', sourceNode: 'output-link', partKey: 'linkages:linkage-2-cell' },
  'gear_linkage.drive-pin': { mechanismType: 'gear_linkage', kind: 'gear-attachment-hole', sourceNode: 'gear[0]', partKey: 'gears:g24' },
  'gear_linkage.output-pin': { mechanismType: 'gear_linkage', kind: 'gear-attachment-hole', sourceNode: 'gear[last]', partKey: 'gears:g24' },
  'gear.drive-pin': { mechanismType: 'gear', kind: 'gear-attachment-hole', sourceNode: 'gear[0]', partKey: 'gears:g24' },
  'gear.output-pin': { mechanismType: 'gear', kind: 'gear-attachment-hole', sourceNode: 'gear[last]', partKey: 'gears:g24' },
  'planetary_gear.carrier-planet-pivot': { mechanismType: 'planetary_gear', kind: 'linkage-hole', sourceNode: 'carrier', partKey: 'linkages:linkage-4-cell' },
  'planetary_gear.carrier-output-hole': { mechanismType: 'planetary_gear', kind: 'linkage-hole', sourceNode: 'carrier', partKey: 'linkages:linkage-4-cell' },
  'cam.guide-mount': { mechanismType: 'cam', kind: 'board-mount-pattern', sourceNode: 'follower-guide', partKey: 'cam_modules:u-channel-guide-cartridge' },
  'cam.follower-output-hole': { mechanismType: 'cam', kind: 'module-hole', sourceNode: 'follower-head', partKey: 'cam_modules:gravity-follower-module-v2' },
  'piston.crank-pin': { mechanismType: 'piston', kind: 'linkage-hole', sourceNode: 'crank-link', partKey: 'linkages:linkage-2-cell' },
  'piston.rod-slider-pin': { mechanismType: 'piston', kind: 'linkage-hole', sourceNode: 'connecting-rod', partKey: 'linkages:linkage-6-cell' },
  'piston.guide-mount': { mechanismType: 'piston', kind: 'board-mount-pattern', sourceNode: 'guide', partKey: 'brackets:3-hole-straight' },
} as const;
assert.deepEqual(CONNECTION_SELECTION_ROLE_POLICIES, expectedPolicies, 'all six authored families use one physical role policy');

const families: Array<{
  type: MechanismType;
  roles: readonly ConnectionSelectionRole[];
  kinds: readonly string[];
}> = [
  { type: '4bar', roles: ['4bar.input-joint', '4bar.output-joint'], kinds: ['linkage-hole', 'linkage-hole'] },
  { type: 'gear_linkage', roles: ['gear_linkage.drive-pin', 'gear_linkage.output-pin'], kinds: ['gear-attachment-hole', 'gear-attachment-hole'] },
  { type: 'gear', roles: ['gear.drive-pin', 'gear.output-pin'], kinds: ['gear-attachment-hole', 'gear-attachment-hole'] },
  { type: 'planetary_gear', roles: ['planetary_gear.carrier-planet-pivot', 'planetary_gear.carrier-output-hole'], kinds: ['linkage-hole', 'linkage-hole'] },
  { type: 'cam', roles: ['cam.guide-mount', 'cam.follower-output-hole'], kinds: ['board-mount-pattern', 'module-hole'] },
  { type: 'piston', roles: ['piston.crank-pin', 'piston.rod-slider-pin', 'piston.guide-mount'], kinds: ['linkage-hole', 'linkage-hole', 'board-mount-pattern'] },
];

for (const { type, roles, kinds } of families) {
  assert.deepEqual(connectionSelectionRolesForMechanism(type), roles, `${type} owns its canonical roles`);
  const defaults = normalizeMechanismConnectionSelections(createDefaultMechanism(type, `v2-${type}`), undefined);
  assert.deepEqual(
    roles.map((role) => defaults.connectionSelections?.[role]?.kind),
    kinds,
    `${type} defaults persist the required physical selection variants`,
  );
}

const current = createEmptyProject();
const v1Raw = JSON.parse(serializeProject({
  ...current,
  mechanisms: [createDefaultMechanism('cam', 'v2-bad-cam')],
})) as Record<string, unknown>;
const rawMechanisms = v1Raw.mechanisms as Array<Record<string, unknown>>;
rawMechanisms[0] = {
  ...rawMechanisms[0],
  connectionSelections: {
    'cam.follower-output-hole': {
      kind: 'module-hole',
      moduleKey: 'x'.repeat(500),
      holeId: 'output-0',
      rawCoordinates: Array.from({ length: 100 }, (_, index) => ({ x: index, y: index })),
    },
  },
};
v1Raw.version = 1;
const v1Result = loadProjectSnapshot(v1Raw, current);
assert.equal(v1Result.status, 'loaded');
if (v1Result.status === 'loaded') {
  assert.equal(v1Result.sourceVersion, 1);
  assert.equal(v1Result.migrated, true);
  assert.equal(v1Result.project.version, 2);
  const loadedCam = v1Result.project.mechanisms[0];
  assert.equal(loadedCam.connectionSelections?.['cam.follower-output-hole'], undefined, 'a rejected imported v2-only selection is not silently replaced');
  const diagnostic = loadedCam.rejectedConnectionSelectionDiagnostics?.find((entry) => entry.role === 'cam.follower-output-hole');
  assert(diagnostic, 'rejected physical selection retains bounded provenance');
  assert.equal(diagnostic.reason, 'invalid-inventory-key');
  assert.equal(diagnostic.catalogKey?.length, 64);
  assert.equal('rawCoordinates' in diagnostic, false);
}

const v2Raw = JSON.parse(serializeProject(current)) as Record<string, unknown>;
const v2Result = loadProjectSnapshot(v2Raw, current);
assert.equal(v2Result.status, 'loaded');
if (v2Result.status === 'loaded') {
  assert.equal(v2Result.sourceVersion, 2);
  assert.equal(v2Result.migrated, false);
}
for (const raw of [{ version: 99, mechanisms: [] }, [], null]) {
  const rejected = loadProjectSnapshot(raw, current);
  assert.equal(rejected.status, 'rejected');
  if (rejected.status === 'rejected') {
    assert.equal(rejected.project, current, 'unsupported ingress preserves the exact last valid aggregate');
    assert.equal(rejected.blocker, 'Fix: Update project');
  }
}

const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storageValues = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, value),
    removeItem: (key: string) => storageValues.delete(key),
    clear: () => storageValues.clear(),
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    get length() { return storageValues.size; },
  } satisfies Storage,
});
try {
  assert.equal(readAutosaveProject(current).status, 'missing');
  for (const raw of [JSON.stringify({ version: 99, mechanisms: [] }), '{bad json']) {
    storageValues.set(STORAGE_KEYS.autosave, raw);
    const rejected = readAutosaveProject(current);
    assert.equal(rejected.status, 'rejected');
    if (rejected.status === 'rejected') {
      assert.equal(rejected.project, current, 'autosave rejection keeps the exact current aggregate');
      assert.equal(rejected.blocker, 'Fix: Update project');
    }
  }
  storageValues.set(STORAGE_KEYS.autosave, serializeProject(current));
  const loadedAutosave = readAutosaveProject(current);
  assert.equal(loadedAutosave.status, 'loaded');
  if (loadedAutosave.status === 'loaded') assert.equal(loadedAutosave.project.version, 2);
} finally {
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

const sourceManifest = JSON.parse(read(source('manifest.template.json'))) as {
  parts: { cam_modules: Array<Record<string, unknown>> };
};
const v2ManifestPart = sourceManifest.parts.cam_modules.find((part) => part.key === 'gravity-follower-module-v2');
assert(v2ManifestPart);
assert.deepEqual(v2ManifestPart.hole_ids, ['output-0', 'output-1', 'output-2']);
assert.equal(v2ManifestPart.inventory_version, 2);
assert.equal(
  read(join(root, 'docs', 'mechanism-reference', 'source', 'assembly-recipes.snapshot.json')),
  read(fabrication('assembly', 'recipes.json')),
  'the mechanism-reference assembly snapshot follows the active v2 source recipes',
);

const v1Oracle = JSON.parse(read(fabrication('fabrication-python-oracle.json'))) as {
  schema_version: number;
  managed_files: string[];
  files: Record<string, unknown>;
};
assert.equal(v1Oracle.schema_version, 1, 'the Python oracle remains frozen at v1');
assert(!v1Oracle.managed_files.includes('cam_modules/gravity-follower-module-v2.svg'));
assert.equal(v1Oracle.files['cam_modules/gravity-follower-module-v2.svg'], undefined);

const v2Oracle = JSON.parse(read(fabrication('fabrication-v2-reviewed-oracle.json'))) as {
  schema_version: number;
  baseline_kind: string;
  base_oracle: string;
  managed_file_additions: string[];
  files: Record<string, { source_svg_sha256: string }>;
};
assert.equal(v2Oracle.schema_version, 2);
assert.equal(v2Oracle.baseline_kind, 'reviewed-source-delta');
assert.equal(v2Oracle.base_oracle, 'fabrication-python-oracle.json');
assert.deepEqual(v2Oracle.managed_file_additions, ['cam_modules/gravity-follower-module-v2.svg']);
for (const relativePath of Object.keys(v2Oracle.files)) {
  assert.equal(
    sha256(read(source(...relativePath.split('/')))),
    v2Oracle.files[relativePath]?.source_svg_sha256,
    `${relativePath} is pinned by the explicit v2 reviewed delta`,
  );
}

console.log('mechanism v2 schema and physical inventory contracts passed');
