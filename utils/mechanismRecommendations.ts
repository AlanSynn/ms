import type { BodyPartLayer, FabricationIssue, MechanismConfig, MechanismType, Point, ProjectMotionPath, ProjectState } from "../types";
import { generateCurvePoints, gearTrainOutputRatio, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from "./kinematics";
import { generateSmartConfig } from "./optimizer";
import { createDefaultMechanism, mechanismWithGeneratedPath } from "./project";
import { newFabricationIssues, sampleFeasibleRange, validateForFabrication, visibleFabricationMessages } from "./fabrication";
import { boardToScene, sceneBoundsForSheet, sceneToBoard, SCENE_PX_PER_MM } from "./coordinates";
import { MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY } from "./mechanismTemplates";
import { isReferenceFoundryVisible, normalizeMechanismToFabricationSet, normalizeMechanismToReference } from "./mechanismReference";
import { fitPathToBox } from "./mechanismPreview";
import { fitFourBarKitMechanismToPath } from "./fourBarPathFit";
import { generateFoundryPlaybackPointTraces, primaryFoundryPlaybackPath } from "./foundryPlayback";
import { preferredMotionJointId } from "./motion";
import { pathOwnedTargetFields } from "./pathTargets";

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

const selectedFoundryTraceId = (mechanism: MechanismConfig) => {
  if (!mechanism.generatedPath?.length || !isReferenceFoundryVisible(mechanism.type))
    return null;
  const traces = generateFoundryPlaybackPointTraces(mechanism, 96).traces;
  if (!traces.length) return null;
  return traces.reduce((best, trace) =>
    traceDistanceToGeneratedPath(trace, mechanism.generatedPath ?? []) <
    traceDistanceToGeneratedPath(best, mechanism.generatedPath ?? [])
      ? trace
      : best,
  ).id;
};

const foundryVisiblePath = (mechanism: MechanismConfig, resolution = 72) => {
  if (mechanism.generatedPath?.length) return mechanism.generatedPath;
  if (isReferenceFoundryVisible(mechanism.type)) {
    const path = primaryFoundryPlaybackPath(mechanism, resolution);
    if (path.length) return path;
  }
  return generateCurvePoints(mechanism, resolution).points;
};

const mechanismWithPreservedFoundryTrace = (
  previous: MechanismConfig,
  next: MechanismConfig,
) => {
  const traceId = selectedFoundryTraceId(previous);
  const generated = mechanismWithGeneratedPath(next);
  if (!traceId) return generated;
  const trace = generateFoundryPlaybackPointTraces(generated, 96).traces.find(
    (candidate) => candidate.id === traceId,
  );
  return trace?.points.length ? { ...generated, generatedPath: trace.points } : generated;
};

const boundsForPoints = (points: Point[]) => {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

const generatedBounds = (mechanism: MechanismConfig) =>
  boundsForPoints(foundryVisiblePath(mechanism, 72));

const physicalSheetFitBounds = (mechanism: MechanismConfig) => {
  const points = mechanism.type === "planetary_gear"
    ? primaryFoundryPlaybackPath(mechanism, 96)
    : generateCurvePoints(mechanism, 96).points;
  return boundsForPoints(points);
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
  });
};

export const fitRecommendedMechanismToSheet = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  const sheet = sceneBoundsForSheet(project.settings.physicalKit);
  const margin = Math.max(
    10,
    project.settings.physicalKit.gridPitchMm * 0.35 * SCENE_PX_PER_MM,
  );
  const boundsForSheet = (candidate: MechanismConfig) =>
    physicalSheetFitBounds(candidate) ?? generatedBounds(candidate);
  const sheetOverflow = (candidate: MechanismConfig) => {
    const bounds = boundsForSheet(candidate);
    if (!bounds) return 0;
    return (
      Math.max(0, sheet.x + margin - bounds.minX) +
      Math.max(0, bounds.maxX - (sheet.x + sheet.width - margin)) +
      Math.max(0, sheet.y + margin - bounds.minY) +
      Math.max(0, bounds.maxY - (sheet.y + sheet.height - margin))
    );
  };
  const searchBoardFit = (seed: MechanismConfig) => {
    let best = seed;
    let bestOverflow = sheetOverflow(seed);
    if (bestOverflow <= 0.01) return best;
    const cells = project.settings.physicalKit.boardCells;
    for (let col = 0; col < cells; col += 1) {
      for (let row = 0; row < cells; row += 1) {
        const anchor = boardToScene(col, row, project.settings.physicalKit);
        const candidate = snapMechanismAnchor(
          {
            ...seed,
            anchorX: anchor.x,
            anchorY: anchor.y,
            sceneAnchor: anchor,
          },
          project,
        );
        const overflow = sheetOverflow(candidate);
        if (overflow < bestOverflow) {
          best = candidate;
          bestOverflow = overflow;
          if (bestOverflow <= 0.01) return best;
        }
      }
    }
    return best;
  };
  let fitted = snapMechanismAnchor(mechanism, project);
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const bounds = boundsForSheet(fitted);
    if (!bounds) return fitted;
    let dx = 0;
    let dy = 0;
    if (bounds.minX < sheet.x + margin) dx = sheet.x + margin - bounds.minX;
    if (bounds.maxX > sheet.x + sheet.width - margin)
      dx = sheet.x + sheet.width - margin - bounds.maxX;
    if (bounds.minY < sheet.y + margin) dy = sheet.y + margin - bounds.minY;
    if (bounds.maxY > sheet.y + sheet.height - margin)
      dy = sheet.y + sheet.height - margin - bounds.maxY;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fitted;
    moved = true;
    const previousAnchor = { x: fitted.anchorX ?? 0, y: fitted.anchorY ?? 0 };
    const adjusted = snapMechanismAnchor(
      {
        ...fitted,
        anchorX: previousAnchor.x + dx,
        anchorY: previousAnchor.y + dy,
      },
      project,
    );
    const adjustedAnchor = {
      x: adjusted.anchorX ?? previousAnchor.x,
      y: adjusted.anchorY ?? previousAnchor.y,
    };
    if (
      Math.hypot(
        adjustedAnchor.x - previousAnchor.x,
        adjustedAnchor.y - previousAnchor.y,
      ) < 0.01
    ) {
      const pitch = project.settings.physicalKit.gridPitchMm * SCENE_PX_PER_MM;
      fitted = snapMechanismAnchor(
        {
          ...fitted,
          anchorX:
            previousAnchor.x + (dx < 0 ? -pitch : dx > 0 ? pitch : 0),
          anchorY:
            previousAnchor.y + (dy < 0 ? -pitch : dy > 0 ? pitch : 0),
        },
        project,
      );
    } else {
      fitted = adjusted;
    }
  }
  const searched = searchBoardFit(fitted);
  const searchedMoved =
    Math.hypot(
      (searched.anchorX ?? 0) - (fitted.anchorX ?? 0),
      (searched.anchorY ?? 0) - (fitted.anchorY ?? 0),
    ) > 0.01;
  return moved || searchedMoved
    ? {
        ...searched,
        warnings: [
          ...(searched.warnings ?? []),
          "Moved onto sheet. Check anchor.",
        ],
      }
    : searched;
};

const fabricationIssuesForCandidate = (
  project: ProjectState,
  mechanism: MechanismConfig,
): FabricationIssue[] => {
  const targetPath = mechanism.targetPathId
    ? project.paths[mechanism.targetPathId]
    : undefined;
  const targetAnchor = mechanism.targetPartId
    ? preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId)
    : undefined;
  const siblingMechanisms = project.mechanisms.filter((m) => {
    if (m.id === mechanism.id) return false;
    if (
      targetPath &&
      m.targetPathId === mechanism.targetPathId &&
      (!mechanism.targetPartId ||
        preferredMotionJointId(project, mechanism.targetPartId, m.targetAnchorJointId) === targetAnchor)
    )
      return false;
    return targetPath ? !mechanismOccupiesPathTarget(project, m, targetPath) : true;
  });
  const baselineIssues = validateForFabrication({ ...project, mechanisms: siblingMechanisms }).issues;
  const candidateProject: ProjectState = {
    ...project,
    mechanisms: [...siblingMechanisms, mechanism],
  };
  return newFabricationIssues(
    baselineIssues,
    validateForFabrication(candidateProject).issues,
  );
};

const fabricationErrorsForCandidate = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => visibleFabricationMessages(fabricationIssuesForCandidate(project, mechanism), 'error');


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

const anchorMechanismAt = (mechanism: MechanismConfig, anchor: Point) =>
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
  });

const fitGearLinkageOutputToPath = (
  project: ProjectState,
  mechanism: MechanismConfig,
  path: ProjectMotionPath,
) => {
  if (mechanism.type !== "gear_linkage" || path.points.length < 3)
    return mechanism;
  const generated = foundryVisiblePath(mechanism, 72);
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
    normalizeGearMeshMechanism({
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

export const fitMechanismToTargetPath = (
  project: ProjectState,
  mechanism: MechanismConfig,
  targetPathId?: string,
): MechanismConfig => {
  const path = targetPathId ? project.paths[targetPathId] : undefined;
  const part = path && !path.sceneObjectId ? project.parts[path.partId] : undefined;
  const object = path?.sceneObjectId ? project.sceneObjects[path.sceneObjectId] : undefined;
  if (!path || (!part && !object) || path.points.length < 3)
    return snapMechanismAnchor(normalizeGearMeshMechanism(mechanism), project);
  if (mechanism.type === "4bar") {
    const fittedFourBar = fitFourBarKitMechanismToPath(project, mechanism, path);
    if (fittedFourBar) return fittedFourBar;
  }
  const fittedCandidate = mechanism.type === "gear_linkage"
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
            ...pathOwnedTargetFields(path),
          }),
          Number.isFinite(mechanism.anchorX) && Number.isFinite(mechanism.anchorY)
            ? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }
            : undefined,
        );
      })();
  const fittedErrors = fabricationErrorsForCandidate(project, fittedCandidate);
  if (!fittedErrors.length) {
    return fittedCandidate;
  }
  const fallback = fitRecommendedMechanismToSheet(
    project,
    readyMechanismFallbackForPath(project, mechanism, path),
  );
  const fallbackErrors = fabricationErrorsForCandidate(project, fallback);
  if (!fallbackErrors.length) return fallback;
  const unchanged = mechanismWithGeneratedPath(
    snapMechanismAnchor(
      normalizeGearMeshMechanism(normalizeMechanismToReference(mechanism)),
      project,
    ),
  );
  const unchangedErrors = fabricationErrorsForCandidate(project, unchanged);
  if (!unchangedErrors.length) return unchanged;
  return mechanismWithGeneratedPath({
    ...unchanged,
    warnings: [
      ...new Set([
        ...(unchanged.warnings ?? []),
        "Fix the mechanism before building.",
      ]),
    ],
  });
};

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
      const kitFittedMechanism = candidate.type === "4bar"
        ? fitFourBarKitMechanismToPath(project, initialMechanism, selectedPath)
        : undefined;
      const initialErrors = fabricationErrorsForCandidate(
        project,
        initialMechanism,
      );
      const mechanism = kitFittedMechanism ?? (initialErrors.length
        ? fitRecommendedMechanismToSheet(
            project,
            readyMechanismFallbackForPath(
              project,
              initialMechanism,
              selectedPath,
            ),
          )
        : initialMechanism);
      const range = sampleFeasibleRange(mechanism);
      const fabricationErrors = fabricationErrorsForCandidate(
        project,
        mechanism,
      );
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
          : (range.warning ?? "Full motion"),
        fabricationErrors,
      };
    })
    .filter((option) => option.fabricationErrors.length === 0)
    .sort((a, b) => b.score - a.score);
};
