import type {
  ConnectionSelection,
  FabricationPartRequirement,
  MechanismConfig,
  PhysicalKitSettings,
} from '../types';
import { boardToScene, defaultPhysicalKit, parseBoardCoordinateLabel, sceneToBoardRaw, SCENE_PX_PER_MM } from './coordinates';
import {
  FABRICATION_BOARD_MOUNT_SPECS,
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_MODULE_SPECS,
  FABRICATION_RING_GEAR_SPEC,
} from './fabricationContract';
import { gearTrainOutputRatio, gearTrainPitchCenterDistance, calculateLinkage, generateCurvePoints, mechanismSafetyPhaseSchedule, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from './kinematics';
import {
  fabricationLinkageEffectiveSceneLength,
  normalizeMechanismToFabricationSet,
  normalizeMechanismToReference,
} from './mechanismReference';
import {
  connectionSelectionRolesForMechanism,
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

const selectionPhysicalPoints = (selection: ConnectionSelection | undefined, kit: PhysicalKitSettings): { x: number; y: number }[] | undefined => {
  if (!selection) return undefined;
  if (selection.kind === 'linkage-hole') {
    const spec = FABRICATION_LINKAGE_SPECS.find(candidate => candidate.key === selection.linkageKey);
    const hole = spec?.holeCentersMm[selection.holeIndex];
    return hole ? [{ x: hole.x * SCENE_PX_PER_MM, y: hole.y * SCENE_PX_PER_MM }] : undefined;
  }
  if (selection.kind === 'gear-attachment-hole') {
    const spec = FABRICATION_GEAR_SPECS.find(candidate => candidate.key === selection.gearKey);
    const hole = spec?.attachmentHoleCentersMm[selection.holeIndex];
    return hole ? [{ x: hole.x * SCENE_PX_PER_MM, y: hole.y * SCENE_PX_PER_MM }] : undefined;
  }
  if (selection.kind === 'board-mount-pattern') {
    const points = selection.boardHoleIds.map(label => parseBoardCoordinateLabel(label)).map(point =>
      point ? boardToScene(point.col, point.row, kit) : undefined
    );
    return points.every(Boolean) ? points as { x: number; y: number }[] : undefined;
  }
  const spec = FABRICATION_MODULE_SPECS.find(candidate => candidate.key === selection.moduleKey);
  const hole = spec?.holes[selection.holeId];
  return hole ? [{ x: hole.x * SCENE_PX_PER_MM, y: hole.y * SCENE_PX_PER_MM }] : undefined;
};

const physicalSelectionDistance = (
  requested: ConnectionSelection | undefined,
  candidate: ConnectionSelection | undefined,
  kit: PhysicalKitSettings,
) => {
  if (!requested && !candidate) return 0;
  if (!requested || !candidate || requested.kind !== candidate.kind) return Number.POSITIVE_INFINITY;
  const requestedPoints = selectionPhysicalPoints(requested, kit);
  const candidatePoints = selectionPhysicalPoints(candidate, kit);
  if (!requestedPoints || !candidatePoints || requestedPoints.length !== candidatePoints.length) return Number.POSITIVE_INFINITY;
  return requestedPoints.reduce((sum, point, index) => sum + Math.hypot(
    point.x - candidatePoints[index].x,
    point.y - candidatePoints[index].y,
  ), 0);
};

const selectionsFor = (mechanism: MechanismConfig, kit: PhysicalKitSettings = defaultPhysicalKit()) =>
  normalizeMechanismWithFabricationSelections(mechanism, kit).connectionSelections ?? {};

const finalizeCandidateMechanism = (mechanism: MechanismConfig, kit: PhysicalKitSettings) =>
  normalizeMechanismWithFabricationSelections(mechanism, kit);

const selectionChanges = (left: MechanismConfig, right: MechanismConfig) =>
  connectionSelectionRolesForMechanism(left.type).reduce(
    (count, role) => count + (selectionKey(left.connectionSelections?.[role]) === selectionKey(right.connectionSelections?.[role]) ? 0 : 1),
    0,
  );

const physicalConnectionDistance = (requested: MechanismConfig, candidate: MechanismConfig, kit: PhysicalKitSettings) => {
  const requestedSelections = selectionsFor(requested, kit);
  const candidateSelections = selectionsFor(candidate, kit);
  return connectionSelectionRolesForMechanism(requested.type).reduce(
    (sum, role) => sum + physicalSelectionDistance(requestedSelections[role], candidateSelections[role], kit),
    0,
  );
};

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

const fullLinkageChoices = (minHoleCount: number, requestedLength: number) =>
  linkageChoices(minHoleCount, requestedLength).filter(fullLinkageChoice);

const linkagePartRequirement = (choice: LinkageChoice, quantity = 1): FabricationPartRequirement => ({
  name: choice.spec.label,
  label: choice.spec.label,
  quantity,
  count: quantity,
  part: `linkages:${choice.spec.key}`,
  category: 'linkages',
  key: choice.spec.key,
});

const withEffectiveCoupler = (mechanism: MechanismConfig, choice: LinkageChoice, quantity = 1): MechanismConfig => ({
  ...mechanism,
  couplerLength: choice.effectiveLength,
  fabricationMetadata: {
    ...(mechanism.fabricationMetadata ?? {}),
    requiredParts: [
      ...(mechanism.fabricationMetadata?.requiredParts ?? []).filter(part => part.category !== 'linkages' || !part.part?.startsWith('linkages:')),
      linkagePartRequirement(choice, quantity),
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

const boardAnchorChoicesForPivot = (requested: MechanismConfig, kit: PhysicalKitSettings) => {
  const requestedX = finite(requested.anchorX);
  const requestedY = finite(requested.anchorY);
  return Array.from({ length: kit.boardCells * kit.boardCells }, (_, index) => {
    const col = index % kit.boardCells;
    const row = Math.floor(index / kit.boardCells);
    const point = boardToScene(col, row, kit);
    return {
      point,
      distance: Math.hypot(point.x - requestedX, point.y - requestedY),
      col,
      row,
    };
  }).sort((left, right) =>
    left.distance - right.distance
    || left.row - right.row
    || left.col - right.col
  ).map(({ point }) => point);
};

const endpointGearChoices = () => FABRICATION_GEAR_SPECS.filter(spec => spec.attachmentHoleCentersMm.length > 0);

const planetaryManifestTuple = () => {
  if (FABRICATION_RING_GEAR_SPEC.key !== 'ring-g8-g24' || FABRICATION_RING_GEAR_SPEC.mountHoleCentersMm.length === 0) return undefined;
  const sun = FABRICATION_GEAR_SPECS.find(spec => spec.teeth === FABRICATION_RING_GEAR_SPEC.compatibleSunTeeth);
  const planet = FABRICATION_GEAR_SPECS.find(spec => spec.teeth === FABRICATION_RING_GEAR_SPEC.compatiblePlanetTeeth);
  if (!sun || !planet) return undefined;
  const sunRadius = sceneLength(sun.pitchRadiusMm);
  const planetRadius = sceneLength(planet.pitchRadiusMm);
  const ringRadius = sceneLength(FABRICATION_RING_GEAR_SPEC.pitchRadiusMm);
  if (Math.abs(ringRadius - (sunRadius + planetRadius * 2)) > EPSILON) return undefined;
  return {
    sun,
    planet,
    ring: FABRICATION_RING_GEAR_SPEC,
    sunRadius,
    planetRadius,
    carrierRadius: sunRadius + planetRadius,
    ringRadius,
  };
};

const gearSelection = (
  role: 'gear.drive-pin' | 'gear.output-pin' | 'gear_linkage.drive-pin' | 'gear_linkage.output-pin',
  mechanism: MechanismConfig,
  spec: (typeof FABRICATION_GEAR_SPECS)[number],
  gearIndex: number,
  requestedSelection?: ConnectionSelection,
): ConnectionSelection => {
  const current = requestedSelection;
  if (
    current?.kind === 'gear-attachment-hole' &&
    current.gearKey === spec.key &&
    current.gearIndex === gearIndex &&
    spec.attachmentHoleCentersMm[current.holeIndex]
  ) return { ...current };
  const requestedLength = current ? abs(mechanism.couplerPointDist) : 0;
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
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
  summary?: string,
): Candidate => {
  const candidateMechanism = intent === 'fit' && (requested.generatedPath?.length ?? 0) > 0
    ? { ...mechanism, generatedPath: generateCurvePoints(mechanism, requested.generatedPath!.length, kit).points }
    : mechanism;
  const requestedRadii = requested.gearTrainRadii ?? [];
  const candidateRadii = candidateMechanism.gearTrainRadii ?? [];
  const gearRadiusError = candidateRadii.reduce((sum, value, index) =>
    sum + Math.abs(value - (requestedRadii[index] ?? (index === 0 ? requested.crankLength : requested.rockerLength))), 0);
  const scalarError = candidateMechanism.type === 'gear' || candidateMechanism.type === 'gear_linkage'
    ? gearRadiusError
      + (candidateMechanism.type === 'gear_linkage'
        ? Math.abs(abs(candidateMechanism.groundLength) - abs(requested.groundLength))
          + Math.abs(abs(candidateMechanism.couplerLength) - abs(requested.couplerLength))
        : 0)
    : Math.abs(candidateMechanism.groundLength - requested.groundLength)
      + Math.abs(candidateMechanism.crankLength - requested.crankLength)
      + Math.abs(candidateMechanism.couplerLength - requested.couplerLength)
      + Math.abs(candidateMechanism.rockerLength - requested.rockerLength);
  const pivotError = Math.hypot(
    finite(candidateMechanism.anchorX) - finite(requested.anchorX),
    finite(candidateMechanism.anchorY) - finite(requested.anchorY),
  );
  const fitError = requested.generatedPath?.length && candidateMechanism.generatedPath?.length
    ? requested.generatedPath.reduce((sum, point, index) => {
      const candidatePoint = candidateMechanism.generatedPath?.[index % candidateMechanism.generatedPath.length];
      return sum + (candidatePoint ? Math.hypot(point.x - candidatePoint.x, point.y - candidatePoint.y) : 0);
    }, 0)
    : 0;
  const snapped = scalarError > EPSILON || pivotError > EPSILON || selectionChanges(candidateMechanism, requested) > 0;
  return {
    mechanism: candidateMechanism,
    key: `${candidateMechanism.type}:${JSON.stringify(candidateMechanism.connectionSelections ?? {})}:${candidateMechanism.gearTrainRadii?.join(',') ?? ''}:${candidateMechanism.anchorX}:${candidateMechanism.anchorY}:${candidateMechanism.groundLength}:${candidateMechanism.couplerLength}`,
    summary,
    snapped,
    scalarError,
    pivotError,
    connectionError: physicalConnectionDistance(requested, candidateMechanism, kit),
    fitError,
    topologyChange: Math.abs((candidateMechanism.gearTrainRadii?.length ?? 0) - (requested.gearTrainRadii?.length ?? 0)),
    changedSelections: selectionChanges(candidateMechanism, previous),
    linkageCells,
  };
};

const candidateScore = (candidate: Candidate, intent: FabricationCombinationIntent) => [
  intent === 'pivot' ? candidate.pivotError : intent === 'connection' ? candidate.connectionError : intent === 'fit' ? candidate.fitError : candidate.scalarError,
  candidate.topologyChange,
  candidate.changedSelections,
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

const fourBarCandidates = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
  scoreRequested: MechanismConfig,
) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const base = normalizeMechanismWithFabricationSelections(requested, kit);
  const inputChoices = linkageChoices(3, abs(requested.crankLength));
  const outputChoices = linkageChoices(3, abs(requested.rockerLength));
  const couplerChoices = fullLinkageChoices(4, abs(requested.couplerLength));
  const candidates: Candidate[] = [];
  for (const groundLength of boardLengths(requested, kit)) {
    for (const input of inputChoices) {
      for (const output of outputChoices) {
        for (const coupler of couplerChoices) {
          const connectionSelections = {
            ...(selectionsFor(base, kit)),
            '4bar.input-joint': { kind: 'linkage-hole', linkageKey: input.spec.key, holeIndex: input.holeIndex } as const,
            '4bar.output-joint': { kind: 'linkage-hole', linkageKey: output.spec.key, holeIndex: output.holeIndex } as const,
          };
          const normalized = normalizeMechanismWithFabricationSelections({ ...base, connectionSelections }, kit);
          const mechanism = finalizeCandidateMechanism(withEffectiveCoupler({
            ...normalized,
            groundLength,
            crankLength: input.effectiveLength,
            rockerLength: output.effectiveLength,
            connectionSelections,
          }, coupler), kit);
          candidates.push(makeCandidate(
            previous,
            scoreRequested,
            mechanism,
            coupler.spec.cells,
            kit,
            intent,
            `Snapped: ${coupler.spec.holeCentersMm.length}-hole`,
          ));
        }
      }
    }
  }
  return candidates;
};

const gearCandidates = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
  scoreRequested: MechanismConfig,
) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const base = normalizeMechanismWithFabricationSelections(requested, kit);
  return gearTupleCandidates(requested).flatMap(specs => {
    const radii = gearRadiiForSpecs(specs);
    const isLinkage = requested.type === 'gear_linkage';
    const pitchSpan = radii.slice(1).reduce((sum, radius, index) => sum + radii[index] + radius, 0);
    const boardPitch = Math.max(1, kit.gridPitchMm * SCENE_PX_PER_MM);
    const groundLengths = isLinkage && specs.length === 2
      ? boardLengths({ ...requested, groundLength: Math.max(abs(requested.groundLength), pitchSpan + boardPitch) }, kit)
        .filter(length => length > pitchSpan + EPSILON)
      : [pitchSpan];
    const selections = {
      ...(selectionsFor(base, kit)),
      ...(isLinkage ? {
        'gear_linkage.drive-pin': gearSelection('gear_linkage.drive-pin', requested, specs[0], 0, requested.connectionSelections?.['gear_linkage.drive-pin']),
        'gear_linkage.output-pin': gearSelection('gear_linkage.output-pin', requested, specs.at(-1)!, specs.length - 1, requested.connectionSelections?.['gear_linkage.output-pin']),
      } : {
        'gear.drive-pin': gearSelection('gear.drive-pin', requested, specs[0], 0, requested.connectionSelections?.['gear.drive-pin']),
        'gear.output-pin': gearSelection('gear.output-pin', requested, specs.at(-1)!, specs.length - 1, requested.connectionSelections?.['gear.output-pin']),
      }),
    };
    const linkageChoicesForCandidate = isLinkage
      ? fullLinkageChoices(2, abs(requested.couplerLength))
      : [undefined];
    return groundLengths.flatMap(groundLength => linkageChoicesForCandidate.map(linkage => {
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
      const mechanism = finalizeCandidateMechanism(linkage
        ? withEffectiveCoupler({
            ...normalized,
            crankLength: radii[0],
            rockerLength: radii.at(-1)!,
            groundLength,
            gearTrainRadii: radii,
            gearRatio: gearTrainOutputRatio(radii),
            speed2: gearTrainOutputRatio(radii),
            connectionSelections: selections,
          }, linkage, 2)
        : {
            ...normalized,
            crankLength: radii[0],
            rockerLength: radii.at(-1)!,
            groundLength,
            gearTrainRadii: radii,
            gearRatio: gearTrainOutputRatio(radii),
            speed2: gearTrainOutputRatio(radii),
            connectionSelections: selections,
          }, kit);
      return makeCandidate(
        previous,
        scoreRequested,
        mechanism,
        linkage?.spec.cells ?? 0,
        kit,
        intent,
        `Snapped: ${specs.map(spec => spec.key).join(' / ')}${linkage ? ` + ${linkage.spec.key} pair` : ''}`,
      );
    }));
  });
};

const planetaryCandidate = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
  scoreRequested: MechanismConfig,
) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const tuple = planetaryManifestTuple();
  if (!tuple) return [];
  const normalized = normalizeMechanismWithFabricationSelections(normalizeMechanismToReference(requested), kit);
  const mechanism: MechanismConfig = finalizeCandidateMechanism({
    ...normalized,
    crankLength: tuple.sunRadius,
    rockerLength: tuple.planetRadius,
    groundLength: tuple.carrierRadius,
    couplerPointDist: tuple.carrierRadius,
    gearRatio: planetaryCarrierOutputRatio(tuple.sunRadius, tuple.planetRadius),
    speed2: planetaryPlanetSpinRatio(tuple.sunRadius, tuple.planetRadius),
    connectionSelections: {
      ...(selectionsFor(normalized, kit)),
      'planetary_gear.carrier-planet-pivot': { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 2 },
      'planetary_gear.carrier-output-hole': { kind: 'linkage-hole', linkageKey: 'linkage-4-cell', holeIndex: 1 },
    },
  }, kit);
  return [makeCandidate(previous, scoreRequested, mechanism, 4, kit, intent, `Snapped: ${tuple.sun.key} / ${tuple.planet.key} / ${tuple.ring.key}`)];
};

const fixedModuleCandidate = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
  scoreRequested: MechanismConfig,
) => {
  if (!boardAnchorIsPlaced(requested, kit)) return [];
  const normalized = normalizeMechanismWithFabricationSelections(normalizeMechanismToReference(requested), kit);
  const mechanism = finalizeCandidateMechanism({
    ...normalized,
    camProfileSamples: requested.type === 'cam' ? normalized.camProfileSamples : normalized.camProfileSamples,
  }, kit);
  return [makeCandidate(previous, scoreRequested, mechanism, 0, kit, intent, requested.type === 'cam' ? 'Snapped: cam module' : 'Snapped: piston kit')];
};

const enumerateCandidatesAtAnchor = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
  scoreRequested: MechanismConfig,
) => {
  if (!AUTHORABLE_TYPES.has(requested.type)) return [];
  if (requested.type === '4bar') return fourBarCandidates(previous, requested, kit, intent, scoreRequested);
  if (requested.type === 'gear' || requested.type === 'gear_linkage') return gearCandidates(previous, requested, kit, intent, scoreRequested);
  if (requested.type === 'planetary_gear') return planetaryCandidate(previous, requested, kit, intent, scoreRequested);
  return fixedModuleCandidate(previous, requested, kit, intent, scoreRequested);
};

const enumerateCandidates = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings,
  intent: FabricationCombinationIntent,
) => {
  if (intent !== 'pivot') return enumerateCandidatesAtAnchor(previous, requested, kit, intent, requested);
  for (const point of boardAnchorChoicesForPivot(requested, kit)) {
    const anchored = { ...requested, anchorX: point.x, anchorY: point.y };
    const candidates = enumerateCandidatesAtAnchor(previous, anchored, kit, intent, requested)
      .sort((left, right) => compareCandidates(left, right, intent));
    const buildable = candidates.filter(candidate => candidateIsBuildable(candidate, kit));
    if (buildable.length) return buildable;
  }
  return [];
};

const effectiveCouplerChoice = (mechanism: MechanismConfig, minHoleCount = 4): LinkageChoice | undefined => {
  const choices = fullLinkageChoices(minHoleCount, abs(mechanism.couplerLength));
  const choice = choices.find(candidate =>
    Math.abs(candidate.effectiveLength - abs(mechanism.couplerLength)) <= EPSILON,
  );
  if (!choice) return undefined;
  const linkageParts = mechanism.fabricationMetadata?.requiredParts?.filter(part =>
    part.part?.startsWith('linkages:'),
  ) ?? [];
  return !linkageParts.length || linkageParts.some(part =>
    part.part === `linkages:${choice.spec.key}`,
  )
    ? choice
    : undefined;
};

const exactGearSpec = (radius: number) => FABRICATION_GEAR_SPECS.find(spec => Math.abs(sceneLength(spec.pitchRadiusMm) - abs(radius)) <= EPSILON);

const mechanismIsBuildable = (mechanism: MechanismConfig, kit: PhysicalKitSettings) => {
  const kinematicsValid = mechanismSafetyPhaseSchedule(mechanism.type).every(phase => calculateLinkage(mechanism, phase, kit).isValid);
  if (!kinematicsValid) return false;
  try {
    const compiled = compileMechanismGraphFabrication(mechanism, kit);
    return compiled.buildable
      && compiled.renderPlan.validationErrors.length === 0
      && validateMechanismPreviewReadiness(mechanism, kit).length === 0;
  } catch {
    return false;
  }
};

export const mechanismUsesExactFabricationCombination = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
) => {
  if (!AUTHORABLE_TYPES.has(mechanism.type) || !boardAnchorIsPlaced(mechanism, kit)) return false;
  const connectionState = normalizeMechanismWithFabricationSelections(mechanism, kit);
  const roles = connectionSelectionRolesForMechanism(mechanism.type);
  const completeSelections = connectionState.connectionSelectionValidation?.status !== 'invalid'
    && roles.every(role => connectionState.connectionSelections?.[role]
      && connectionState.connectionSelectionValidation?.entries.some(entry => entry.role === role && entry.status === 'accepted'));
  if (!completeSelections) return false;
  const exactMechanism = { ...mechanism, ...connectionState };
  if (!mechanismIsBuildable(exactMechanism, kit)) return false;
  const selections = exactMechanism.connectionSelections;
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
    const actualGround = abs(mechanism.groundLength);
    const boardPitch = Math.max(1, kit.gridPitchMm * SCENE_PX_PER_MM);
    const groundIsBoardAligned = Math.abs(actualGround / boardPitch - Math.round(actualGround / boardPitch)) <= EPSILON;
    const groundIsClosed = mechanism.type === 'gear_linkage' && radii.length === 2
      ? actualGround > pitchSpan + EPSILON && groundIsBoardAligned
      : Math.abs(actualGround - pitchSpan) <= EPSILON;
    const roles = connectionSelectionRolesForMechanism(mechanism.type);
    const holesValid = roles.every(role => {
      const selection = selections?.[role];
      if (selection?.kind !== 'gear-attachment-hole') return false;
      const spec = FABRICATION_GEAR_SPECS.find(candidate => candidate.key === selection.gearKey);
      return Boolean(spec?.attachmentHoleCentersMm[selection.holeIndex])
        && selection.gearIndex === (role.endsWith('drive-pin') ? 0 : radii.length - 1)
        && selection.gearKey === specs[selection.gearIndex]?.key;
    });
    const pairedLinkage = mechanism.type === 'gear_linkage'
      ? effectiveCouplerChoice(mechanism, 2)
      : undefined;
    const pairedPart = pairedLinkage
      ? mechanism.fabricationMetadata?.requiredParts?.find(part =>
          part.part === `linkages:${pairedLinkage.spec.key}`
          && (part.quantity ?? part.count ?? 0) >= 2)
      : undefined;
    return holesValid
      && groundIsClosed
      && (mechanism.type !== 'gear_linkage' || Boolean(pairedLinkage && pairedPart))
      && Math.abs((mechanism.gearRatio ?? Number.NaN) - gearTrainOutputRatio(radii)) <= EPSILON
      && Math.abs((mechanism.speed2 ?? Number.NaN) - gearTrainOutputRatio(radii)) <= EPSILON;
  }
  if (mechanism.type === 'planetary_gear') {
    const tuple = planetaryManifestTuple();
    if (!tuple) return false;
    const planet = selections?.['planetary_gear.carrier-planet-pivot'];
    const output = selections?.['planetary_gear.carrier-output-hole'];
    return Math.abs(abs(mechanism.crankLength) - tuple.sunRadius) <= EPSILON
      && Math.abs(abs(mechanism.rockerLength) - tuple.planetRadius) <= EPSILON
      && Math.abs(abs(mechanism.groundLength) - tuple.carrierRadius) <= EPSILON
      && planet?.kind === 'linkage-hole' && planet.linkageKey === 'linkage-4-cell' && planet.holeIndex >= 2 && planet.holeIndex <= 4
      && output?.kind === 'linkage-hole' && output.linkageKey === 'linkage-4-cell'
      && Math.abs((mechanism.gearRatio ?? Number.NaN) - planetaryCarrierOutputRatio(tuple.sunRadius, tuple.planetRadius)) <= EPSILON
      && Math.abs((mechanism.speed2 ?? Number.NaN) - planetaryPlanetSpinRatio(tuple.sunRadius, tuple.planetRadius)) <= EPSILON;
  }
  const normalized = normalizeMechanismToFabricationSet(mechanism);
  const fixedFields = mechanism.type === 'cam'
    ? ['groundAngle', 'groundLength', 'crankLength', 'sliderOffset', 'rockerLength', 'couplerLength'] as const
    : ['groundAngle', 'groundLength', 'crankLength', 'couplerLength', 'rockerLength', 'sliderOffset', 'rodLength'] as const;
  return fixedFields.every(field => Math.abs(finite(mechanism[field]) - finite(normalized[field])) <= EPSILON)
    && FABRICATION_MODULE_SPECS.length > 0
    && FABRICATION_BOARD_MOUNT_SPECS.length > 0;
};

const candidateIsBuildable = (candidate: Candidate, kit: PhysicalKitSettings) => {
  return mechanismIsBuildable(candidate.mechanism, kit);
};

export const resolveFabricationCombination = (
  previous: MechanismConfig,
  requested: MechanismConfig,
  kit: PhysicalKitSettings = defaultPhysicalKit(),
  intent: FabricationCombinationIntent = 'scalar',
): FabricationCombinationResolution => {
  if (intent === 'profile' || intent === 'creation') {
    return { status: 'rejected', mechanism: previous, blocker: 'No kit fit' };
  }
  const candidates = enumerateCandidates(previous, requested, kit, intent)
    .sort((left, right) => compareCandidates(left, right, intent));
  const winner = candidates.find(candidate => candidateIsBuildable(candidate, kit));
  return winner
    ? { status: 'accepted', mechanism: winner.mechanism, snapped: winner.snapped, ...(winner.summary ? { summary: winner.summary } : {}) }
    : { status: 'rejected', mechanism: previous, blocker: 'No kit fit' };
};
