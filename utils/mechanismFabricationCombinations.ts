import type {
  ConnectionSelection,
  FabricationPartRequirement,
  MechanismConfig,
  PhysicalKitSettings,
} from '../types';
import { boardToScene, defaultPhysicalKit, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import {
  FABRICATION_BOARD_MOUNT_SPECS,
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_MODULE_SPECS,
} from './fabricationContract';
import { gearTrainOutputRatio, gearTrainPitchCenterDistance, calculateLinkage, mechanismSafetyPhaseSchedule, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from './kinematics';
import {
  fabricationLinkageEffectiveSceneLength,
  normalizeMechanismToFabricationSet,
  normalizeMechanismToReference,
} from './mechanismReference';
import {
  connectionSelectionRolesForMechanism,
  normalizeMechanismConnectionSelections,
  normalizeMechanismWithFabricationSelections,
} from './mechanismConnectionSelections';
import { compileMechanismGraphFabrication } from './mechanismCompiler';
import { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';

export type FabricationCombinationIntent =
  | 'scalar'
  | 'pivot'
  | 'connection'
  | 'fit'
  | 'profile'
  | 'creation';

export type FabricationCombinationResolution =
  | { status: 'accepted'; mechanism: MechanismConfig; snapped: boolean; summary?: string }
  | { status: 'rejected'; mechanism: MechanismConfig; blocker: 'No kit fit' };

type LinkageChoice = {
  spec: (typeof FABRICATION_LINKAGE_SPECS)[number];
  holeIndex: number;
  effectiveLength: number;
};

type Candidate = {
  mechanism: MechanismConfig;
  key: string;
  summary?: string;
  snapped: boolean;
  scalarError: number;
  pivotError: number;
  connectionError: number;
  fitError: number;
  topologyChange: number;
  changedSelections: number;
  linkageCells: number;
};

const AUTHORABLE_TYPES = new Set<MechanismConfig['type']>([
  '4bar',
  'gear',
  'gear_linkage',
  'planetary_gear',
  'cam',
  'piston',
]);

const EPSILON = 1e-6;
const finite = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value as number : fallback;
const abs = (value: number | undefined) => Math.abs(finite(value));
const sceneLength = (millimetres: number) => millimetres * SCENE_PX_PER_MM;

const selectionKey = (selection: ConnectionSelection | undefined) => {
  if (!selection) return '';
  if (selection.kind === 'linkage-hole') return `${selection.kind}:${selection.linkageKey}:${selection.holeIndex}`;
  if (selection.kind === 'gear-attachment-hole') return `${selection.kind}:${selection.gearKey}:${selection.gearIndex}:${selection.holeIndex}`;
  if (selection.kind === 'board-mount-pattern') return `${selection.kind}:${selection.mountKey}:${selection.boardHoleIds.join(',')}`;
  return `${selection.kind}:${selection.moduleKey}:${selection.holeId}`;
};

const selectionsFor = (mechanism: MechanismConfig) =>
  normalizeMechanismConnectionSelections(
    mechanism,
    mechanism.connectionSelections,
    mechanism.connectionSelectionValidation,
  ).connectionSelections ?? {};

const selectionChanges = (left: MechanismConfig, right: MechanismConfig) =>
  connectionSelectionRolesForMechanism(left.type).reduce(
    (count, role) => count + (selectionKey(left.connectionSelections?.[role]) === selectionKey(right.connectionSelections?.[role]) ? 0 : 1),
    0,
  );

const nearestHoleIndex = (
  points: readonly { x: number; y: number }[],
  requestedLength: number,
  allowOrigin = false,
) => points.reduce((best, point, index) => {
  if (!allowOrigin && index === 0) return best;
  const length = Math.hypot(point.x - points[0].x, point.y - points[0].y) * SCENE_PX_PER_MM;
  const error = Math.abs(length - requestedLength);
  return error < best.error || (error === best.error && index < best.index)
    ? { index, error }
    : best;
}, { index: allowOrigin ? 0 : 1, error: Number.POSITIVE_INFINITY }).index;

const linkageChoices = (minHoleCount: number, requestedLength: number): LinkageChoice[] =>
  FABRICATION_LINKAGE_SPECS
    .filter(spec => spec.holeCentersMm.length >= minHoleCount)
    .flatMap(spec => spec.holeCentersMm.slice(1).map((_, offset) => {
      const holeIndex = offset + 1;
      return {
        spec,
        holeIndex,
        effectiveLength: fabricationLinkageEffectiveSceneLength(spec, holeIndex),
      };
    }))
    .sort((left, right) =>
      Math.abs(left.effectiveLength - requestedLength) - Math.abs(right.effectiveLength - requestedLength)
      || left.spec.cells - right.spec.cells
      || left.holeIndex - right.holeIndex
      || left.spec.key.localeCompare(right.spec.key));

const fullLinkageChoice = (choice: LinkageChoice) =>
  Math.abs(choice.effectiveLength - sceneLength(choice.spec.lengthMm)) <= EPSILON;

const linkagePartRequirement = (choice: LinkageChoice): FabricationPartRequirement => ({
  name: choice.spec.label,
  label: choice.spec.label,
  quantity: 1,
  count: 1,
  part: `linkages:${choice.spec.key}`,
  category: 'linkages',
  key: choice.spec.key,
});

const withEffectiveCoupler = (mechanism: MechanismConfig, choice: LinkageChoice): MechanismConfig => ({
  ...mechanism,
  couplerLength: choice.effectiveLength,
  fabricationMetadata: {
    ...(mechanism.fabricationMetadata ?? {}),
    requiredParts: [
      ...(mechanism.fabricationMetadata?.requiredParts ?? []).filter(part => part.category !== 'linkages' || !part.part?.startsWith('linkages:')),
      linkagePartRequirement(choice),
    ],
  },
});

const boardLengths = (mechanism: MechanismConfig, kit: PhysicalKitSettings) => {
  const pitch = Math.max(1, kit.gridPitchMm * SCENE_PX_PER_MM);
  const maxCells = Math.max(1, kit.boardCells - 1);
  const values = new Set<number>([Math.max(pitch, Math.round(abs(mechanism.groundLength) / pitch) * pitch)]);
  for (let cell = 1; cell <= maxCells; cell += 1) values.add(cell * pitch);
  return [...values].sort((left, right) => Math.abs(left - abs(mechanism.groundLength)) - Math.abs(right - abs(mechanism.groundLength)) || left - right);
};

const boardAnchorIsPlaced = (mechanism: MechanismConfig, kit: PhysicalKitSettings) => {
  const point = { x: finite(mechanism.anchorX), y: finite(mechanism.anchorY) };
  const board = sceneToBoardRaw(point, kit);
  const snapped = boardToScene(board.col, board.row, kit);
  return board.valid && Math.hypot(point.x - snapped.x, point.y - snapped.y) <= Math.max(1, kit.gridPitchMm * SCENE_PX_PER_MM * 0.03);
};

const endpointGearChoices = () => FABRICATION_GEAR_SPECS.filter(spec => spec.attachmentHoleCentersMm.length > 0);

const gearSelection = (
  role: 'gear.drive-pin' | 'gear.output-pin' | 'gear_linkage.drive-pin' | 'gear_linkage.output-pin',
  mechanism: MechanismConfig,
  spec: (typeof FABRICATION_GEAR_SPECS)[number],
  gearIndex: number,
): ConnectionSelection => {
  const current = mechanism.connectionSelections?.[role];
  const requestedLength = current?.kind === 'gear-attachment-hole' && current.gearKey === spec.key
    ? Math.hypot(...Object.values(spec.attachmentHoleCentersMm[current.holeIndex] ?? { x: 0, y: 0 })) * SCENE_PX_PER_MM
    : abs(mechanism.couplerPointDist);
  const holeIndex = nearestHoleIndex(spec.attachmentHoleCentersMm, requestedLength, true);
  return { kind: 'gear-attachment-hole', gearKey: spec.key, gearIndex, holeIndex };
};

const gearRadiiForSpecs = (specs: readonly (typeof FABRICATION_GEAR_SPECS)[number][]) => specs.map(spec => sceneLength(spec.pitchRadiusMm));

const gearSpecsForMechanism = (mechanism: MechanismConfig, endpointsOnly = false) => {
  const count = Math.max(2, Math.min(8, mechanism.gearTrainRadii?.length ?? 2));
  const endpoints = endpointGearChoices();
  const all = FABRICATION_GEAR_SPECS;
  return Array.from({ length: count }, (_, index) => (index === 0 || index === count - 1) ? endpoints : all);
};

const gearTupleCandidates = (mechanism: MechanismConfig) => {
  const pools = gearSpecsForMechanism(mechanism);
  const result: Array<(typeof FABRICATION_GEAR_SPECS)[number][]> = [];
  const visit = (index: number, current: (typeof FABRICATION_GEAR_SPECS)[number][]) => {
    if (index === pools.length) {
      result.push([...current]);
      return;
    }
    pools[index].forEach(spec => visit(index + 1, [...current, spec]));
  };
  visit(0, []);
  return result.sort((left, right) => {
    const leftError = left.reduce((sum, spec, index) => sum + Math.abs(sceneLength(spec.pitchRadiusMm) - abs(mechanism.gearTrainRadii?.[index] ?? (index === 0 ? mechanism.crankLength : mechanism.rockerLength))), 0);
    const rightError = right.reduce((sum, spec, index) => sum + Math.abs(sceneLength(spec.pitchRadiusMm) - abs(mechanism.gearTrainRadii?.[index] ?? (index === 0 ? mechanism.crankLength : mechanism.rockerLength))), 0);
    return leftError - rightError || left.map(spec => spec.key).join(',').localeCompare(right.map(spec => spec.key).join(','));
  });
};

const makeCandidate = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  mechanism: MechanismConfig,
  linkageCells: number,
  summary?: string,
): Candidate => {
  const requestedRadii = requested.gearTrainRadii ?? [];
  const candidateRadii = mechanism.gearTrainRadii ?? [];
  const scalarError = mechanism.type === 'gear' || mechanism.type === 'gear_linkage'
    ? candidateRadii.reduce((sum, value, index) => sum + Math.abs(value - (requestedRadii[index] ?? (index === 0 ? requested.crankLength : requested.rockerLength))), 0)
    : Math.abs(mechanism.groundLength - requested.groundLength)
      + Math.abs(mechanism.crankLength - requested.crankLength)
      + Math.abs(mechanism.couplerLength - requested.couplerLength)
      + Math.abs(mechanism.rockerLength - requested.rockerLength);
  const pivotError = Math.hypot(
    finite(mechanism.anchorX) - finite(requested.anchorX),
    finite(mechanism.anchorY) - finite(requested.anchorY),
  );
  const fitError = requested.generatedPath?.length && mechanism.generatedPath?.length
    ? requested.generatedPath.reduce((sum, point, index) => {
      const candidatePoint = mechanism.generatedPath?.[index % mechanism.generatedPath.length];
      return sum + (candidatePoint ? Math.hypot(point.x - candidatePoint.x, point.y - candidatePoint.y) : 0);
    }, 0)
    : 0;
  const snapped = scalarError > EPSILON || selectionChanges(mechanism, requested) > 0;
  return {
    mechanism,
    key: `${mechanism.type}:${JSON.stringify(mechanism.connectionSelections ?? {})}:${mechanism.gearTrainRadii?.join(',') ?? ''}:${mechanism.groundLength}:${mechanism.couplerLength}`,
    summary,
    snapped,
    scalarError,
    pivotError,
    connectionError: selectionChanges(mechanism, requested),
    fitError,
    topologyChange: Math.abs((mechanism.gearTrainRadii?.length ?? 0) - (requested.gearTrainRadii?.length ?? 0)),
    changedSelections: selectionChanges(mechanism, previous),
    linkageCells,
  };
};

const candidateScore = (candidate: Candidate, intent: FabricationCombinationIntent) => [
  intent === 'pivot' ? candidate.pivotError : intent === 'connection' ? candidate.connectionError : intent === 'fit' ? candidate.fitError : candidate.scalarError,
  candidate.topologyChange,
  candidate.changedSelections,
  candidate.connectionError,
  candidate.linkageCells,
  candidate.key,
] as const;

const compareCandidates = (left: Candidate, right: Candidate, intent: FabricationCombinationIntent) => {
  const leftScore = candidateScore(left, intent);
  const rightScore = candidateScore(right, intent);
  for (let index = 0; index < leftScore.length; index += 1) {
    const a = leftScore[index];
    const b = rightScore[index];
    if (a === b) continue;
    return typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b) : Number(a) - Number(b);
  }
  return 0;
};

const fourBarCandidates = (previous: MechanismConfig, requested: MechanismConfig, kit: PhysicalKitSettings) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const base = normalizeMechanismWithFabricationSelections(requested, kit);
  const inputChoices = linkageChoices(3, abs(requested.crankLength));
  const outputChoices = linkageChoices(3, abs(requested.rockerLength));
  const couplerChoices = linkageChoices(4, abs(requested.couplerLength));
  const candidates: Candidate[] = [];
  for (const groundLength of boardLengths(requested, kit)) {
    for (const input of inputChoices) {
      for (const output of outputChoices) {
        for (const coupler of couplerChoices) {
          const connectionSelections = {
            ...(selectionsFor(base)),
            '4bar.input-joint': { kind: 'linkage-hole', linkageKey: input.spec.key, holeIndex: input.holeIndex } as const,
            '4bar.output-joint': { kind: 'linkage-hole', linkageKey: output.spec.key, holeIndex: output.holeIndex } as const,
          };
          const normalized = normalizeMechanismWithFabricationSelections({ ...base, connectionSelections }, kit);
          const mechanism = withEffectiveCoupler({
            ...normalized,
            groundLength,
            crankLength: input.effectiveLength,
            rockerLength: output.effectiveLength,
            connectionSelections,
          }, coupler);
          candidates.push(makeCandidate(
            previous,
            requested,
            mechanism,
            coupler.spec.cells,
            `Snapped: ${coupler.spec.holeCentersMm.length}-hole`,
          ));
        }
      }
    }
  }
  return candidates;
};

const gearCandidates = (previous: MechanismConfig, requested: MechanismConfig, kit: PhysicalKitSettings) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const base = normalizeMechanismWithFabricationSelections(requested, kit);
  return gearTupleCandidates(requested).map(specs => {
    const radii = gearRadiiForSpecs(specs);
    const isLinkage = requested.type === 'gear_linkage';
    const pitchSpan = radii.slice(1).reduce((sum, radius, index) => sum + radii[index] + radius, 0);
    const requestedGround = abs(requested.groundLength);
    const boardPitch = Math.max(1, kit.gridPitchMm * SCENE_PX_PER_MM);
    const groundLength = isLinkage && specs.length === 2
      ? Math.max(pitchSpan + boardPitch, Math.max(boardPitch, Math.round(requestedGround / boardPitch) * boardPitch))
      : pitchSpan;
    const selections = {
      ...(selectionsFor(base)),
      ...(isLinkage ? {
        'gear_linkage.drive-pin': gearSelection('gear_linkage.drive-pin', requested, specs[0], 0),
        'gear_linkage.output-pin': gearSelection('gear_linkage.output-pin', requested, specs.at(-1)!, specs.length - 1),
      } : {
        'gear.drive-pin': gearSelection('gear.drive-pin', requested, specs[0], 0),
        'gear.output-pin': gearSelection('gear.output-pin', requested, specs.at(-1)!, specs.length - 1),
      }),
    };
    const normalized = normalizeMechanismWithFabricationSelections({
      ...base,
      crankLength: radii[0],
      rockerLength: radii.at(-1)!,
      groundLength,
      gearTrainRadii: radii,
      gearRatio: gearTrainOutputRatio(radii),
      speed2: gearTrainOutputRatio(radii),
      connectionSelections: selections,
    }, kit);
    return makeCandidate(previous, requested, {
      ...normalized,
      crankLength: radii[0],
      rockerLength: radii.at(-1)!,
      groundLength,
      gearTrainRadii: radii,
      gearRatio: gearTrainOutputRatio(radii),
      speed2: gearTrainOutputRatio(radii),
      connectionSelections: selections,
    }, 0, `Snapped: ${specs.map(spec => spec.key).join(' / ')}`);
  });
};

const planetaryCandidate = (previous: MechanismConfig, requested: MechanismConfig, kit: PhysicalKitSettings) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const normalized = normalizeMechanismWithFabricationSelections(normalizeMechanismToReference(requested), kit);
  const mechanism: MechanismConfig = {
    ...normalized,
    crankLength: sceneLength(10),
    rockerLength: sceneLength(30),
    groundLength: sceneLength(40),
    couplerPointDist: sceneLength(40),
    gearRatio: planetaryCarrierOutputRatio(sceneLength(10), sceneLength(30)),
    speed2: planetaryPlanetSpinRatio(sceneLength(10), sceneLength(30)),
    connectionSelections: {
      ...(selectionsFor(normalized)),
      'planetary_gear.carrier-planet-pivot': { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 2 },
      'planetary_gear.carrier-output-hole': { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 1 },
    },
  };
  return [makeCandidate(previous, requested, mechanism, 4, 'Snapped: G1 / G3 / R56')];
};

const fixedModuleCandidate = (previous: MechanismConfig, requested: MechanismConfig, kit: PhysicalKitSettings) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const normalized = normalizeMechanismWithFabricationSelections(normalizeMechanismToReference(requested), kit);
  const connectionState = normalizeMechanismConnectionSelections(normalized, undefined, undefined, { kit });
  const mechanism = {
    ...normalized,
    ...connectionState,
    camProfileSamples: requested.type === 'cam' ? normalized.camProfileSamples : normalized.camProfileSamples,
  };
  return [makeCandidate(previous, requested, mechanism, 0, requested.type === 'cam' ? 'Snapped: cam module' : 'Snapped: piston kit')];
};

const enumerateCandidates = (previous: MechanismConfig, requested: MechanismConfig, kit: PhysicalKitSettings) => {
  if (!AUTHORABLE_TYPES.has(requested.type)) return [];
  if (requested.type === '4bar') return fourBarCandidates(previous, requested, kit);
  if (requested.type === 'gear' || requested.type === 'gear_linkage') return gearCandidates(previous, requested, kit);
  if (requested.type === 'planetary_gear') return planetaryCandidate(previous, requested, kit);
  return fixedModuleCandidate(previous, requested, kit);
};

const effectiveCouplerChoice = (mechanism: MechanismConfig): LinkageChoice | undefined => {
  const choices = linkageChoices(4, abs(mechanism.couplerLength));
  const selectedPart = mechanism.fabricationMetadata?.requiredParts?.find(part => part.part?.startsWith('linkages:'))?.part?.slice('linkages:'.length);
  return choices.find(choice =>
    Math.abs(choice.effectiveLength - abs(mechanism.couplerLength)) <= EPSILON
      && (!selectedPart || choice.spec.key === selectedPart)
  );
};

const exactGearSpec = (radius: number) => FABRICATION_GEAR_SPECS.find(spec => Math.abs(sceneLength(spec.pitchRadiusMm) - abs(radius)) <= EPSILON);

const exactSelections = (mechanism: MechanismConfig) => {
  const state = normalizeMechanismConnectionSelections(mechanism, mechanism.connectionSelections, mechanism.connectionSelectionValidation);
  return state.connectionSelections;
};

export const mechanismUsesExactFabricationCombination = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  if (!AUTHORABLE_TYPES.has(mechanism.type) || !boardAnchorIsPlaced(mechanism, kit)) return false;
  const selections = exactSelections(mechanism);
  if (mechanism.type === '4bar') {
    const input = selections?.['4bar.input-joint'];
    const output = selections?.['4bar.output-joint'];
    const inputSelection = input?.kind === 'linkage-hole' ? input : undefined;
    const outputSelection = output?.kind === 'linkage-hole' ? output : undefined;
    const inputSpec = inputSelection ? FABRICATION_LINKAGE_SPECS.find(spec => spec.key === inputSelection.linkageKey) : undefined;
    const outputSpec = outputSelection ? FABRICATION_LINKAGE_SPECS.find(spec => spec.key === outputSelection.linkageKey) : undefined;
    const inputLength = inputSpec && inputSelection ? fabricationLinkageEffectiveSceneLength(inputSpec, inputSelection.holeIndex) : Number.NaN;
    const outputLength = outputSpec && outputSelection ? fabricationLinkageEffectiveSceneLength(outputSpec, outputSelection.holeIndex) : Number.NaN;
    return Number.isFinite(inputLength) && Number.isFinite(outputLength)
      && Math.abs(abs(mechanism.crankLength) - inputLength) <= EPSILON
      && Math.abs(abs(mechanism.rockerLength) - outputLength) <= EPSILON
      && Math.abs(abs(mechanism.groundLength) / (kit.gridPitchMm * SCENE_PX_PER_MM) - Math.round(abs(mechanism.groundLength) / (kit.gridPitchMm * SCENE_PX_PER_MM))) <= EPSILON
      && Boolean(effectiveCouplerChoice(mechanism));
  }
  if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage') {
    const radii = mechanism.gearTrainRadii ?? [];
    const specs = radii.map(exactGearSpec);
    if (radii.length < 2 || specs.some(spec => !spec)) return false;
    const pitchSpan = gearTrainPitchCenterDistance(mechanism);
    const expectedGround = mechanism.type === 'gear_linkage' && radii.length === 2
      ? Math.max(pitchSpan, abs(mechanism.groundLength))
      : pitchSpan;
    const roles = connectionSelectionRolesForMechanism(mechanism.type);
    const holesValid = roles.every(role => {
      const selection = selections?.[role];
      if (selection?.kind !== 'gear-attachment-hole') return false;
      const spec = FABRICATION_GEAR_SPECS.find(candidate => candidate.key === selection.gearKey);
      return Boolean(spec?.attachmentHoleCentersMm[selection.holeIndex])
        && selection.gearIndex === (role.endsWith('drive-pin') ? 0 : radii.length - 1)
        && selection.gearKey === specs[selection.gearIndex]?.key;
    });
    return holesValid
      && Math.abs(abs(mechanism.groundLength) - expectedGround) <= EPSILON
      && Math.abs((mechanism.gearRatio ?? Number.NaN) - gearTrainOutputRatio(radii)) <= EPSILON
      && Math.abs((mechanism.speed2 ?? Number.NaN) - gearTrainOutputRatio(radii)) <= EPSILON;
  }
  if (mechanism.type === 'planetary_gear') {
    const planet = selections?.['planetary_gear.carrier-planet-pivot'];
    const output = selections?.['planetary_gear.carrier-output-hole'];
    return Math.abs(abs(mechanism.crankLength) - sceneLength(10)) <= EPSILON
      && Math.abs(abs(mechanism.rockerLength) - sceneLength(30)) <= EPSILON
      && Math.abs(abs(mechanism.groundLength) - sceneLength(40)) <= EPSILON
      && planet?.kind === 'linkage-hole' && planet.linkageKey === 'linkage-4-cell' && planet.holeIndex >= 2 && planet.holeIndex <= 4
      && output?.kind === 'linkage-hole' && output.linkageKey === 'linkage-4-cell'
      && Math.abs((mechanism.gearRatio ?? Number.NaN) - planetaryCarrierOutputRatio(sceneLength(10), sceneLength(30))) <= EPSILON
      && Math.abs((mechanism.speed2 ?? Number.NaN) - planetaryPlanetSpinRatio(sceneLength(10), sceneLength(30))) <= EPSILON;
  }
  const normalized = normalizeMechanismToFabricationSet(mechanism);
  const normalizedSelections = normalizeMechanismConnectionSelections(mechanism, mechanism.connectionSelections, mechanism.connectionSelectionValidation, { kit });
  const fixedFields = mechanism.type === 'cam'
    ? ['groundAngle', 'groundLength', 'crankLength', 'sliderOffset', 'rockerLength', 'couplerLength'] as const
    : ['groundAngle', 'groundLength', 'crankLength', 'couplerLength', 'rockerLength', 'sliderOffset', 'rodLength'] as const;
  return fixedFields.every(field => Math.abs(finite(mechanism[field]) - finite(normalized[field])) <= EPSILON)
    && normalizedSelections.connectionSelectionValidation?.status !== 'invalid'
    && FABRICATION_MODULE_SPECS.length > 0
    && FABRICATION_BOARD_MOUNT_SPECS.length > 0;
};

const candidateGateMechanism = (candidate: MechanismConfig) => {
  if (candidate.type !== '4bar') return candidate;
  const choice = effectiveCouplerChoice(candidate);
  if (!choice || fullLinkageChoice(choice)) return candidate;
  return { ...candidate, couplerLength: sceneLength(choice.spec.lengthMm) };
};

const candidateIsBuildable = (candidate: Candidate, kit: PhysicalKitSettings) => {
  const mechanism = candidate.mechanism;
  const kinematicsValid = mechanismSafetyPhaseSchedule(mechanism.type).every(phase => calculateLinkage(mechanism, phase, kit).isValid);
  if (!kinematicsValid) return false;
  try {
    const compiled = compileMechanismGraphFabrication(candidateGateMechanism(mechanism), kit);
    if (!compiled.buildable || compiled.renderPlan.validationErrors.length) return false;
    const readinessErrors = validateMechanismPreviewReadiness(mechanism, kit);
    const toleratedEffectiveCoupler = mechanism.type === '4bar'
      && effectiveCouplerChoice(mechanism)
      && !fullLinkageChoice(effectiveCouplerChoice(mechanism)!);
    return readinessErrors.every(error => toleratedEffectiveCoupler && error === 'snap four-bar linkage lengths.');
  } catch {
    return false;
  }
};

export const resolveFabricationCombination = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
  intent: FabricationCombinationIntent = 'scalar',
): FabricationCombinationResolution => {
  const candidates = enumerateCandidates(previous, requested, kit)
    .sort((left, right) => compareCandidates(left, right, intent));
  const winner = candidates.find(candidate => candidateIsBuildable(candidate, kit));
  return winner
    ? { status: 'accepted', mechanism: winner.mechanism, snapped: winner.snapped, ...(winner.summary ? { summary: winner.summary } : {}) }
    : { status: 'rejected', mechanism: previous, blocker: 'No kit fit' };
};
