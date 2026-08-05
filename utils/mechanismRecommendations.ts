import type { BodyPartLayer, MechanismConfig, MechanismType, PhysicalKitSettings, Point, ProjectMotionPath, ProjectState } from "../types";
import { generateCurvePoints, gearTrainOutputRatio, mechanismSafetyPhaseSchedule, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from "./kinematics";
import { generateSmartConfig } from "./optimizer";
import { createDefaultMechanism } from "./mechanismDefaults";
import { mechanismWithGeneratedPath } from "./mechanismGeneratedPath";
import { sampleFeasibleRange } from "./fabrication";
import { compactStudentActionForFabricationDiagnostic } from "./fabricationReadiness";
import { boardToScene, sceneToBoard, SCENE_PX_PER_MM } from "./coordinates";
import { MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY } from "./mechanismTemplates";
import { isReferenceFoundryVisible, normalizeMechanismToFabricationSet, normalizeMechanismToReference } from "./mechanismReference";
import { normalizeAuthoredMechanismToFabricationSet } from "./mechanismConnectionSelections";
import { fitPathToBox } from "./mechanismPreview";
import { compileMechanismGraphFabrication } from "./mechanismCompiler";
import { mechanismDescriptorWithinSheet } from "./mechanismCollision";
import { buildMechanismPhysicalEnvelopeDescriptors } from "./mechanismPhysicalEnvelope";
import {
  completeAutomaticFitCandidate,
  fitFourBarKitMechanismToPathResult,
  type AutomaticFitResult,
} from "./fourBarPathFit";
import { resolveFabricationCandidate } from "./mechanismEditAuthority";
import { generateFoundryPlaybackPointTraces, primaryFoundryPlaybackPath } from "./foundryPlayback";
import {
  pointOnGeneratedMechanismPath,
  pointOnProjectPath,
  preferredMotionJointId,
} from "./motion";
import {
  assessMechanismTargetBinding,
  MECHANISM_BINDING_BLOCKER,
  pathOwnedTargetFields,
} from "./pathTargets";

export type MechanismRecommendation = {
  type: MechanismType;
  label: string;
  score: number;
  reason: string;
  mechanism: MechanismConfig;
  previewPath: string;
  feasibility: string;
  fabricationErrors: string[];
};

const pathMetrics = (path: ProjectMotionPath) => {
  const xs = path.points.map((p) => p.x);
  const ys = path.points.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const direct = Math.hypot(
    path.points.at(-1)!.x - path.points[0].x,
    path.points.at(-1)!.y - path.points[0].y,
  );
  const length =
    path.points
      .slice(1)
      .reduce(
        (sum, p, i) =>
          sum + Math.hypot(p.x - path.points[i].x, p.y - path.points[i].y),
        0,
      ) || 1;
  const closure =
    Math.hypot(
      path.points[0].x - path.points.at(-1)!.x,
      path.points[0].y - path.points.at(-1)!.y,
    ) / Math.max(width, height, 1);
  return {
    width,
    height,
    aspect: width / height,
    directness: direct / length,
    closure,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    length,
  };
};

const fabricationCombinationTypes = new Set<MechanismType>([
  "4bar",
  "gear",
  "gear_linkage",
  "planetary_gear",
  "cam",
  "piston",
]);

const traceDistanceToGeneratedPath = (
  trace: { points: Point[] },
  generatedPath: Point[],
) => {
  if (!trace.points.length || !generatedPath.length)
    return Number.POSITIVE_INFINITY;
  const count = Math.min(12, trace.points.length, generatedPath.length);
  return Array.from({ length: count }, (_, index) => {
    const generatedIndex = Math.round(
      (index * (generatedPath.length - 1)) / Math.max(1, count - 1),
    );
    const traceIndex = Math.round(
      (index * (trace.points.length - 1)) / Math.max(1, count - 1),
    );
    const a = generatedPath[generatedIndex];
    const b = trace.points[traceIndex];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }).reduce((sum, distance) => sum + distance, 0);
};

const selectedFoundryTraceId = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
) => {
  if (!mechanism.generatedPath?.length || !isReferenceFoundryVisible(mechanism.type))
    return null;
  const traces = generateFoundryPlaybackPointTraces(mechanism, 96, kit).traces;
  if (!traces.length) return null;
  return traces.reduce((best, trace) =>
    traceDistanceToGeneratedPath(trace, mechanism.generatedPath ?? []) <
    traceDistanceToGeneratedPath(best, mechanism.generatedPath ?? [])
      ? trace
      : best,
  ).id;
};

const foundryVisiblePath = (
  mechanism: MechanismConfig,
  resolution: number,
  kit: PhysicalKitSettings,
) => {
  if (mechanism.generatedPath?.length) return mechanism.generatedPath;
  if (isReferenceFoundryVisible(mechanism.type)) {
    const path = primaryFoundryPlaybackPath(mechanism, resolution, kit);
    if (path.length) return path;
  }
  return generateCurvePoints(mechanism, resolution, kit).points;
};

const mechanismWithPreservedFoundryTrace = (
  previous: MechanismConfig,
  next: MechanismConfig,
  kit: PhysicalKitSettings,
) => {
  const traceId = selectedFoundryTraceId(previous, kit);
  const generated = mechanismWithGeneratedPath(next, { kit });
  if (!traceId) return generated;
  const trace = generateFoundryPlaybackPointTraces(generated, 96, kit).traces.find(
    (candidate) => candidate.id === traceId,
  );
  return trace?.points.length ? { ...generated, generatedPath: trace.points } : generated;
};

export const snapMechanismAnchor = (
  mechanism: MechanismConfig,
  project: ProjectState,
) => {
  const board = sceneToBoard(
    { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 },
    project.settings.physicalKit,
  );
  const anchor = boardToScene(
    board.col,
    board.row,
    project.settings.physicalKit,
  );
  return mechanismWithPreservedFoundryTrace(mechanism, {
    ...mechanism,
    anchorX: anchor.x,
    anchorY: anchor.y,
    sceneAnchor: anchor,
    transform: {
      ...(mechanism.transform ?? {
        x: anchor.x,
        y: anchor.y,
        rotation: mechanism.groundAngle ?? 0,
        scale: 1,
      }),
      x: anchor.x,
      y: anchor.y,
    },
  }, project.settings.physicalKit);
};

export const fitRecommendedMechanismToSheet = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  const kit = project.settings.physicalKit;
  const previousAnchor = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
  const seed = snapMechanismAnchor(mechanism, project);
  const seedAnchor = { x: seed.anchorX ?? 0, y: seed.anchorY ?? 0 };
  const boardStep = kit.gridPitchMm * SCENE_PX_PER_MM;
  const previousBoard = sceneToBoard(previousAnchor, kit);
  const previousSnapped = boardToScene(previousBoard.col, previousBoard.row, kit);
  const previousAnchorWasSubHole = Math.hypot(previousAnchor.x - previousSnapped.x, previousAnchor.y - previousSnapped.y) > 0.01;
  const score = (candidate: MechanismConfig) => {
    const compiled = compileMechanismGraphFabrication(candidate, kit);
    const descriptors = buildMechanismPhysicalEnvelopeDescriptors(
      candidate,
      undefined,
      compiled.renderPlan,
      kit,
    );
    return {
      invalid:
        !compiled.buildable ||
        compiled.renderPlan.validationErrors.length > 0 ||
        descriptors.length === 0 ||
        new Set(descriptors.map((descriptor) => descriptor.phaseIndex)).size !==
          mechanismSafetyPhaseSchedule(candidate.type).length,
      outside: descriptors.filter(
        (descriptor) => !mechanismDescriptorWithinSheet(descriptor, kit),
      ).length,
    };
  };

  const resolveSheetCandidate = (candidate: MechanismConfig) => {
    if (!fabricationCombinationTypes.has(candidate.type)) return candidate;
    const result = resolveFabricationCandidate(
      mechanism,
      candidate,
      kit,
      "scalar",
    );
    return result.status === "accepted"
      ? mechanismWithGeneratedPath(result.mechanism, { kit })
      : undefined;
  };
  const considerCandidate = (
    candidate: MechanismConfig,
    distance: number,
  ) => {
    const resolved = resolveSheetCandidate(candidate);
    if (!resolved) return;
    const candidateScore = score(resolved);
    if (
      (bestScore.invalid && !candidateScore.invalid) ||
      (bestScore.invalid === candidateScore.invalid &&
        candidateScore.outside < bestScore.outside) ||
      (bestScore.invalid === candidateScore.invalid &&
        candidateScore.outside === bestScore.outside &&
        distance < bestDistance)
    ) {
      best = resolved;
      bestScore = candidateScore;
      bestDistance = distance;
    }
  };

  const retained = project.mechanisms.find((candidate) => candidate.id === mechanism.id);
  const fallbackSeed = snapMechanismAnchor(
    {
      ...createDefaultMechanism(mechanism.type, mechanism.id),
      visible: mechanism.visible,
      enabled: mechanism.enabled,
      color: mechanism.color,
      anchorX: seed.anchorX,
      anchorY: seed.anchorY,
      sceneAnchor: seed.sceneAnchor,
      targetPartId: mechanism.targetPartId,
      targetSceneObjectId: mechanism.targetSceneObjectId,
      targetPathId: mechanism.targetPathId,
      targetAnchorJointId: mechanism.targetAnchorJointId,
      source: mechanism.source,
      presetId: mechanism.presetId,
      recommendation: mechanism.recommendation,
    },
    project,
  );
  let best = resolveSheetCandidate(seed) ??
    (retained ? resolveSheetCandidate(retained) : undefined) ??
    resolveSheetCandidate(fallbackSeed);
  if (!best) throw new Error("No kit fit");
  let bestScore = score(best);
  let bestDistance = 0;
  const isBoardSnapBack =
    Math.hypot(
      (seed.anchorX ?? 0) - previousSnapped.x,
      (seed.anchorY ?? 0) - previousSnapped.y,
    ) < 0.01;
  if (!bestScore.invalid && bestScore.outside === 0) return best;

  for (let col = 0; col < kit.boardCells; col += 1) {
    for (let row = 0; row < kit.boardCells; row += 1) {
      const anchor = boardToScene(col, row, kit);
      const candidate = snapMechanismAnchor(
        { ...seed, anchorX: anchor.x, anchorY: anchor.y, sceneAnchor: anchor },
        project,
      );
      const distance = Math.hypot(anchor.x - seedAnchor.x, anchor.y - seedAnchor.y);
      considerCandidate(candidate, distance);
    }
  }

  if (previousAnchorWasSubHole && isBoardSnapBack && bestScore.invalid) {
    const nudgeOffsets = [
      { x: seedAnchor.x + boardStep, y: seedAnchor.y },
      { x: seedAnchor.x - boardStep, y: seedAnchor.y },
      { x: seedAnchor.x, y: seedAnchor.y + boardStep },
      { x: seedAnchor.x, y: seedAnchor.y - boardStep },
    ];
    for (const candidateAnchor of nudgeOffsets) {
      considerCandidate(
        snapMechanismAnchor(
          {
            ...seed,
            anchorX: candidateAnchor.x,
            anchorY: candidateAnchor.y,
            sceneAnchor: candidateAnchor,
          },
          project,
        ),
        Math.hypot(
          candidateAnchor.x - seedAnchor.x,
          candidateAnchor.y - seedAnchor.y,
        ),
      );
    }
  }

  const moved = bestDistance > 0.01;
  return moved
    ? {
        ...best,
        warnings: [
          ...(best.warnings ?? []),
          "Moved onto sheet. Check anchor.",
        ],
      }
    : best;
};

export const normalizeGearMeshMechanism = (
  mechanism: MechanismConfig,
): MechanismConfig => {
  return normalizeMechanismToFabricationSet(mechanism);
};

const normalizedId = (id?: string) => {
  const trimmed = id?.trim();
  return trimmed || undefined;
};

const mechanismOccupiesPathTarget = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
) => {
  if (!mechanism.visible || mechanism.enabled === false) return false;
  const mechanismTargetPathId = normalizedId(mechanism.targetPathId);
  if (mechanismTargetPathId && mechanismTargetPathId === normalizedId(path.id))
    return true;
  const mechanismPath = mechanismTargetPathId
    ? project.paths[mechanismTargetPathId]
    : undefined;
  if (path.sceneObjectId) {
    return (
      normalizedId(mechanism.targetSceneObjectId) === normalizedId(path.sceneObjectId) ||
      normalizedId(mechanismPath?.sceneObjectId) === normalizedId(path.sceneObjectId)
    );
  }
  if (mechanismPath?.sceneObjectId) return false;
  const pathPartId = normalizedId(path.partId);
  const pathAnchor = preferredMotionJointId(
    project,
    pathPartId,
    normalizedId(path.targetAnchorJointId),
  );
  const mechanismPartId = normalizedId(mechanismPath?.partId ?? mechanism.targetPartId);
  const mechanismAnchor = preferredMotionJointId(
    project,
    mechanismPartId,
    normalizedId(mechanism.targetAnchorJointId ?? mechanismPath?.targetAnchorJointId),
  );
  return mechanismPartId === pathPartId && mechanismAnchor === pathAnchor;
};

const exactPathTargetOccupied = (
  project: ProjectState,
  path: ProjectMotionPath,
  mechanismId?: string,
) =>
  project.mechanisms.some((mechanism) => {
    if (mechanism.id === mechanismId) return false;
    return mechanismOccupiesPathTarget(project, mechanism, path);
  });

const createRecommendedMechanism = (
  project: ProjectState,
  selectedPart: BodyPartLayer | undefined,
  selectedPath: ProjectMotionPath,
  type: MechanismType,
  reason: string,
  score: number,
): MechanismConfig => {
  const metrics = pathMetrics(selectedPath);
  const targetFields = pathOwnedTargetFields(selectedPath);
  const landingBoard = sceneToBoard(
    selectedPath.points[0],
    project.settings.physicalKit,
  );
  const landing = boardToScene(
    landingBoard.col,
    landingBoard.row,
    project.settings.physicalKit,
  );
  const first = selectedPath.points[0];
  const last = selectedPath.points.at(-1) ?? first;
  const travelAngle =
    (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI;
  const span = Math.max(metrics.width, metrics.height, 40);
  const base = createDefaultMechanism(type, `recommend-${type}`);
  const smart = generateSmartConfig(selectedPath.points, type);
  const tunedCrankLength = Math.max(20, Math.min(90, span * 0.24));
  const tunedRockerLength =
    type === "cam"
      ? Math.max(36, Math.min(130, metrics.height * 0.9))
      : type === "rack-pinion"
        ? Math.max(
            tunedCrankLength * (2 * Math.PI + 2.2),
            Math.min(420, Math.max(180, metrics.length * 0.95)),
          )
        : Math.max(40, Math.min(180, span * 0.55));
  const tunedGroundLength =
    type === "cam" || type === "yoke" || type === "rack-pinion"
      ? 0
      : type === "gear" || type === "gear_linkage" || type === "planetary_gear"
        ? tunedCrankLength + tunedRockerLength
        : Math.max(60, Math.min(220, span * 0.85));
  const tunedGearRatio =
    type === "gear" || type === "gear_linkage"
      ? gearTrainOutputRatio([tunedCrankLength, tunedRockerLength])
      : type === "planetary_gear"
        ? planetaryCarrierOutputRatio(tunedCrankLength, tunedRockerLength)
        : undefined;
  const tuned: MechanismConfig = {
    ...base,
    ...smart,
    id: `recommend-${type}`,
    type,
    visible: true,
    enabled: true,
    color: base.color,
    anchorX: landing.x,
    anchorY: landing.y,
    groundAngle: Number.isFinite(travelAngle) ? travelAngle : base.groundAngle,
    crankLength: tunedCrankLength,
    groundLength: tunedGroundLength,
    couplerLength:
      type === "gear" ||
      type === "planetary_gear" ||
      type === "cam" ||
      type === "yoke" ||
      type === "rack-pinion"
        ? 0
        : Math.max(
            70,
            Math.min(
              260,
              type === "6bar" ? span * 0.78 : metrics.length * 0.55,
            ),
          ),
    rockerLength: tunedRockerLength,
    sliderOffset:
      type === "piston" || type === "yoke"
        ? Math.max(-80, Math.min(80, metrics.height * 0.2))
        : type === "rack-pinion"
          ? Math.max(30, Math.min(100, span * 0.28))
          : base.sliderOffset,
    couplerPointDist: Math.max(35, Math.min(190, span * 0.72)),
    couplerPointAngle:
      type === "piston" || type === "rack-pinion" ? 0 : base.couplerPointAngle,
    gearRatio: tunedGearRatio,
    gearTrainRadii:
      type === "gear" || type === "gear_linkage"
        ? [tunedCrankLength, tunedRockerLength]
        : undefined,
    speed2:
      type === "planetary_gear"
        ? planetaryPlanetSpinRatio(tunedCrankLength, tunedRockerLength)
        : (tunedGearRatio ?? base.speed2),
    rodLength:
      type === "6bar"
        ? Math.max(55, Math.min(180, span * 0.52))
        : (smart.rodLength ?? base.rodLength),
    assemblyMode: type === "6bar" ? "open" : base.assemblyMode,
    phase: 0,
    ...targetFields,
    source: "optimized",
    presetId: `recommendation-${type}`,
    recommendation: reason,
    warnings: score < 55 ? ["Low confidence. Check Foundry."] : [],
  };
  const normalized = mechanismWithGeneratedPath(
    normalizeGearMeshMechanism(normalizeMechanismToReference(tuned)),
    { kit: project.settings.physicalKit },
  );
  return fitRecommendedMechanismToSheet(project, normalized);
};

const localizeFittedMechanismAnchor = (
  project: ProjectState,
  fitted: MechanismConfig,
  requestedAnchor?: Point,
  maxDistance = 120,
): MechanismConfig => {
  if (!requestedAnchor) return fitted;
  const current = { x: fitted.anchorX ?? 0, y: fitted.anchorY ?? 0 };
  if (
    !Number.isFinite(requestedAnchor.x) ||
    !Number.isFinite(requestedAnchor.y) ||
    !Number.isFinite(current.x) ||
    !Number.isFinite(current.y)
  ) {
    return fitted;
  }
  const distance = Math.hypot(
    current.x - requestedAnchor.x,
    current.y - requestedAnchor.y,
  );
  if (distance <= maxDistance || distance < 0.01) return fitted;
  const scale = maxDistance / distance;
  return snapMechanismAnchor(
    {
      ...fitted,
      anchorX: requestedAnchor.x + (current.x - requestedAnchor.x) * scale,
      anchorY: requestedAnchor.y + (current.y - requestedAnchor.y) * scale,
    },
    project,
  );
};

const nearestPathError = (a: Point[], b: Point[]) => {
  if (!a.length || !b.length) return Infinity;
  const oneWay = (from: Point[], to: Point[]) =>
    from.reduce((sum, point) => {
      let best = Infinity;
      to.forEach((other) => {
        best = Math.min(best, Math.hypot(point.x - other.x, point.y - other.y));
      });
      return sum + best;
    }, 0) / from.length;
  return (oneWay(a, b) + oneWay(b, a)) / 2;
};

const centerOf = (points: Point[]) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
};

const anchorMechanismAt = (
  mechanism: MechanismConfig,
  anchor: Point,
  kit: PhysicalKitSettings,
) =>
  mechanismWithGeneratedPath({
    ...mechanism,
    anchorX: anchor.x,
    anchorY: anchor.y,
    sceneAnchor: anchor,
    transform: {
      ...(mechanism.transform ?? {
        x: anchor.x,
        y: anchor.y,
        rotation: mechanism.groundAngle ?? 0,
        scale: 1,
      }),
      x: anchor.x,
      y: anchor.y,
    },
  }, { kit });

const fitGearLinkageOutputToPath = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
) => {
  if (mechanism.type !== "gear_linkage" || path.points.length < 3)
    return mechanism;
  const generated = foundryVisiblePath(
    mechanism,
    72,
    project.settings.physicalKit,
  );
  if (!generated.length) return mechanism;
  const currentAnchor = { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
  const generatedCenter = centerOf(generated);
  const targetCenter = centerOf(path.points);
  const targetBoard = sceneToBoard(
    {
      x: currentAnchor.x + targetCenter.x - generatedCenter.x,
      y: currentAnchor.y + targetCenter.y - generatedCenter.y,
    },
    project.settings.physicalKit,
  );
  const radius = 4;
  let best = anchorMechanismAt(
    mechanism,
    boardToScene(targetBoard.col, targetBoard.row, project.settings.physicalKit),
    project.settings.physicalKit,
  );
  let bestScore = Infinity;
  const scoreCandidate = (candidate: MechanismConfig) => {
    const score = nearestPathError(candidate.generatedPath ?? [], path.points);
    if (!Number.isFinite(score) || score >= bestScore) return;
    best = candidate;
    bestScore = score;
  };
  scoreCandidate(mechanism);
  scoreCandidate(best);
  for (
    let col = Math.max(0, targetBoard.col - radius);
    col <= Math.min(project.settings.physicalKit.boardCells - 1, targetBoard.col + radius);
    col += 1
  ) {
    for (
      let row = Math.max(0, targetBoard.row - radius);
      row <= Math.min(project.settings.physicalKit.boardCells - 1, targetBoard.row + radius);
      row += 1
    ) {
      scoreCandidate(
        anchorMechanismAt(
          mechanism,
          boardToScene(col, row, project.settings.physicalKit),
          project.settings.physicalKit,
        ),
      );
    }
  }
  return best;
};

const readyMechanismFallbackForPath = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path?: ProjectMotionPath,
): MechanismConfig => {
  const seedPoint = path?.points[0] ?? {
    x: mechanism.anchorX ?? 0,
    y: mechanism.anchorY ?? 0,
  };
  const boardAnchor = sceneToBoard(seedPoint, project.settings.physicalKit);
  const anchor = boardToScene(
    boardAnchor.col,
    boardAnchor.row,
    project.settings.physicalKit,
  );
  return snapMechanismAnchor(
    normalizeAuthoredMechanismToFabricationSet({
      ...mechanism,
      anchorX: anchor.x,
      anchorY: anchor.y,
      sceneAnchor: anchor,
      ...(path
        ? pathOwnedTargetFields(path)
        : {
            targetPartId: mechanism.targetPartId,
            targetSceneObjectId: mechanism.targetSceneObjectId,
            targetPathId: mechanism.targetPathId,
            targetAnchorJointId: mechanism.targetAnchorJointId,
            activeVisualPartIds: mechanism.activeVisualPartIds ?? [],
          }),
    }),
    project,
  );
};

export const fitMechanismToTargetPathResult = (
  project: ProjectState,
  mechanism: MechanismConfig,
  targetPathId?: string,
): AutomaticFitResult => {
  const path = targetPathId ? project.paths[targetPathId] : undefined;
  const part = path && !path.sceneObjectId ? project.parts[path.partId] : undefined;
  const object = path?.sceneObjectId ? project.sceneObjects[path.sceneObjectId] : undefined;
  if (!path || (!part && !object)) {
    const assessment = assessMechanismTargetBinding(project, {
      ...mechanism,
      targetPathId,
    });
    const result = completeAutomaticFitCandidate(project, mechanism, mechanism);
    return {
      ...result,
      mechanism,
      accepted: false,
      blockers: [MECHANISM_BINDING_BLOCKER],
      recoveryCandidates: assessment.recoveryCandidates,
    };
  }
  if (path.points.length < 3) {
    const result = completeAutomaticFitCandidate(project, mechanism, mechanism);
    return { ...result, mechanism, accepted: false, blockers: ["Draw a path."] };
  }
  const targetFields = pathOwnedTargetFields(path);
  const resolveFitCandidate = (candidate: MechanismConfig) => {
    if (!fabricationCombinationTypes.has(candidate.type)) return candidate;
    const result = resolveFabricationCandidate(
      mechanism,
      candidate,
      project.settings.physicalKit,
      "fit",
      { candidateIsCatalogSnapped: true },
    );
    return result.status === "accepted"
      ? mechanismWithGeneratedPath(result.mechanism, {
          kit: project.settings.physicalKit,
        })
      : undefined;
  };
  const unchanged = resolveFitCandidate(mechanismWithGeneratedPath(
    snapMechanismAnchor(
      normalizeAuthoredMechanismToFabricationSet(
        normalizeMechanismToReference({ ...mechanism, ...targetFields }),
        project.settings.physicalKit,
      ),
      project,
    ),
    { kit: project.settings.physicalKit },
  ));
  const fourBarResult = mechanism.type === "4bar"
    ? fitFourBarKitMechanismToPathResult(project, mechanism, path)
    : undefined;
  const noKitFit = (error: unknown) => error instanceof Error && error.message === "No kit fit";
  let fittedCandidate: MechanismConfig | undefined;
  try {
    fittedCandidate = mechanism.type === "4bar"
      ? fourBarResult?.mechanism
      : mechanism.type === "gear_linkage"
        ? fitGearLinkageOutputToPath(
            project,
            readyMechanismFallbackForPath(project, mechanism, path),
            path,
          )
        : (() => {
          const fitted = createRecommendedMechanism(
            project,
            part,
            path,
            mechanism.type,
            mechanism.recommendation ?? "Fit",
            80,
          );
          return localizeFittedMechanismAnchor(
            project,
            mechanismWithGeneratedPath({
              ...fitted,
              id: mechanism.id,
              color: mechanism.color ?? fitted.color,
              visible: mechanism.visible,
              enabled: mechanism.enabled,
              source: mechanism.source ?? fitted.source,
              presetId: mechanism.presetId ?? fitted.presetId,
              recommendation: mechanism.recommendation ?? fitted.recommendation,
              warnings: mechanism.warnings ?? fitted.warnings,
              transform: mechanism.transform ?? fitted.transform,
              connectionSelections: mechanism.connectionSelections ?? fitted.connectionSelections,
              connectionSelectionValidation:
                mechanism.connectionSelectionValidation ?? fitted.connectionSelectionValidation,
              ...targetFields,
            }, { kit: project.settings.physicalKit }),
            Number.isFinite(mechanism.anchorX) && Number.isFinite(mechanism.anchorY)
              ? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }
              : undefined,
          );
        })();
  } catch (error) {
    if (!noKitFit(error)) throw error;
  }
  let fallback: MechanismConfig | undefined;
  try {
    fallback = fitRecommendedMechanismToSheet(
      project,
      readyMechanismFallbackForPath(project, mechanism, path),
    );
  } catch (error) {
    if (!noKitFit(error)) throw error;
  }
  const targetSamples = Array.from({ length: 96 }, (_, index) =>
    pointOnProjectPath(path, (index / 96) * Math.PI * 2),
  );
  const fitScore = (candidate: MechanismConfig) => {
    const generated = foundryVisiblePath(
      candidate,
      96,
      project.settings.physicalKit,
    );
    const first = generated[0];
    const targetStart = targetSamples[0];
    const startDistance = first && targetStart
      ? Math.hypot(first.x - targetStart.x, first.y - targetStart.y)
      : Number.POSITIVE_INFINITY;
    const phaseError = path.timedPoints?.length && generated.length
      ? targetSamples.reduce((sum, target, index) => {
          const phase = (index / targetSamples.length) * Math.PI * 2;
          const generatedPoint = pointOnGeneratedMechanismPath(generated, phase);
          return generatedPoint
            ? sum + Math.hypot(generatedPoint.x - target.x, generatedPoint.y - target.y)
            : Number.POSITIVE_INFINITY;
        }, 0) / targetSamples.length
      : 0;
    return nearestPathError(generated, targetSamples) + startDistance * 0.25 + phaseError;
  };
  const completed = [
    ...(fourBarResult ? [fourBarResult] : []),
    ...[fittedCandidate, fallback, unchanged]
      .filter((candidate): candidate is MechanismConfig => Boolean(candidate))
      .filter((candidate) => candidate !== fourBarResult?.mechanism)
      .map((candidate) => resolveFitCandidate(candidate))
      .filter((candidate): candidate is MechanismConfig => Boolean(candidate))
      .map((candidate) => completeAutomaticFitCandidate(project, mechanism, candidate)),
  ];
  const viable = completed
    .filter((result) => result.accepted)
    .sort((a, b) => fitScore(a.mechanism) - fitScore(b.mechanism));
  if (viable[0]) return viable[0];
  const priorResult = completeAutomaticFitCandidate(project, mechanism, mechanism);
  return {
    ...priorResult,
    mechanism: priorResult.mechanism,
    accepted: false,
    blockers: [...new Set([
      ...completed.flatMap((result) => result.blockers),
      ...priorResult.blockers,
    ])],
  };
};

export const fitMechanismToTargetPath = (
  project: ProjectState,
  mechanism: MechanismConfig,
  targetPathId?: string,
): MechanismConfig => fitMechanismToTargetPathResult(
  project,
  mechanism,
  targetPathId,
).mechanism;

export const buildMechanismRecommendations = (
  project: ProjectState,
  selectedPart?: BodyPartLayer,
  selectedPath?: ProjectMotionPath,
): MechanismRecommendation[] => {
  if (!selectedPath || (!selectedPart && !selectedPath.sceneObjectId) || selectedPath.points.length < 3)
    return [];
  if (exactPathTargetOccupied(project, selectedPath)) return [];
  const metrics = pathMetrics(selectedPath);
  const compact = Math.max(metrics.width, metrics.height) < 120;
  const linear = metrics.directness > 0.72;
  const closed = selectedPath.closed || metrics.closure < 0.35;
  const candidates: Array<{
    type: MechanismType;
    score: number;
    reason: string;
  }> = [
    {
      type: "4bar",
      score:
        78 +
        (linear ? -6 : 8) +
        (metrics.aspect > 0.7 && metrics.aspect < 2.6 ? 8 : 0),
      reason: "Arc limb",
    },
    {
      type: "piston",
      score:
        62 +
        (linear ? 22 : 0) +
        (metrics.aspect > 2.0 || metrics.aspect < 0.5 ? 8 : 0),
      reason: "Push-pull",
    },
    {
      type: "cam",
      score:
        57 +
        (metrics.height > metrics.width * 0.75 ? 12 : 0) +
        (compact ? 8 : 0),
      reason: "Lift",
    },
    {
      type: "gear_linkage",
      score: 61 + (closed ? 8 : 0) + (linear ? 5 : 12),
      reason: "Gear crank",
    },
    { type: "gear", score: 48 + (closed ? 20 : 0), reason: "Reverse rotation" },
    {
      type: "planetary_gear",
      score: 45 + (closed && compact ? 28 : 6),
      reason: "Compact loop",
    },
  ];
  return candidates
    .map((candidate) => {
      const initialMechanism = createRecommendedMechanism(
        project,
        selectedPart,
        selectedPath,
        candidate.type,
        candidate.reason,
        candidate.score,
      );
      const strictFitSeed = {
        ...createDefaultMechanism(candidate.type, `recommend-${candidate.type}`),
        ...pathOwnedTargetFields(selectedPath),
      };
      const kitFit = candidate.type === "4bar"
        ? fitFourBarKitMechanismToPathResult(project, strictFitSeed, selectedPath)
        : undefined;
      const fallback = fitRecommendedMechanismToSheet(
        project,
        readyMechanismFallbackForPath(project, initialMechanism, selectedPath),
      );
      const completed = [
        ...(kitFit ? [kitFit] : []),
        completeAutomaticFitCandidate(project, strictFitSeed, initialMechanism),
        completeAutomaticFitCandidate(project, strictFitSeed, fallback),
      ].find((result) => result.accepted);
      const mechanism = completed?.mechanism ?? initialMechanism;
      const range = sampleFeasibleRange(
        mechanism,
        96,
        project.settings.physicalKit,
      );
      const fabricationErrors = completed?.blockers ?? ['No safe fit.'];
      return {
        type: candidate.type,
        label: MECHANISM_LIBRARY[candidate.type].label,
        score: Math.max(
          1,
          Math.min(
            99,
            Math.round(
              candidate.score -
                (range.percentValid < 1 ? 12 : 0) -
                (fabricationErrors.length ? 35 : 0),
            ),
          ),
        ),
        reason: candidate.reason,
        mechanism,
        previewPath: fitPathToBox(mechanism.generatedPath ?? [], 220, 120),
        feasibility: fabricationErrors.length
          ? "Fix the mechanism before building."
          : (compactStudentActionForFabricationDiagnostic(range.warning) ?? "Full motion"),
        fabricationErrors,
        accepted: Boolean(completed),
      };
    })
    .filter((option) => option.accepted)
    .map(({ accepted: _accepted, ...option }) => option)
    .sort((a, b) => b.score - a.score);
};
