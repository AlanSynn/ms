import type { BodyPartLayer, MechanismConfig, MechanismType, Point, ProjectMotionPath, ProjectState } from "../types";
import { generateCurvePoints, gearTrainOutputRatio, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio } from "./kinematics";
import { generateSmartConfig } from "./optimizer";
import { createDefaultMechanism, mechanismWithGeneratedPath } from "./project";
import { sampleFeasibleRange, validateMechanismPreviewReadiness, validateForFabrication } from "./fabrication";
import { boardToScene, sceneBoundsForSheet, sceneToBoard, SCENE_PX_PER_MM } from "./coordinates";
import { motionAnchorJointIds, preferredMotionJointId } from "./motion";
import { MECHANISM_TEMPLATE_LIBRARY as MECHANISM_LIBRARY } from "./mechanismTemplates";
import { normalizeMechanismToFabricationSet, normalizeMechanismToReference } from "./mechanismReference";
import { fitPathToBox } from "./mechanismPreview";
import { fitFourBarKitMechanismToPath } from "./fourBarPathFit";

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

const generatedBounds = (mechanism: MechanismConfig) => {
  const points = generateCurvePoints(mechanism, 72).points;
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

const snapMechanismAnchor = (
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
  return mechanismWithGeneratedPath({
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
  let fitted = snapMechanismAnchor(mechanism, project);
  let moved = false;
  for (let i = 0; i < 4; i++) {
    const bounds = generatedBounds(fitted);
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
  return moved
    ? {
        ...fitted,
        warnings: [
          ...(fitted.warnings ?? []),
          "Moved onto sheet. Check anchor.",
        ],
      }
    : fitted;
};

const fabricationErrorsForCandidate = (
  project: ProjectState,
  mechanism: MechanismConfig,
) => {
  const readinessErrors = validateMechanismPreviewReadiness(mechanism).map(
    (error) => `${mechanism.id}: ${error}`,
  );
  const siblingMechanisms = project.mechanisms.filter(
    (m) => m.id !== mechanism.id,
  );
  const baseline = new Set(
    validateForFabrication({ ...project, mechanisms: siblingMechanisms }).errors,
  );
  const candidateProject: ProjectState = {
    ...project,
    mechanisms: [...siblingMechanisms, mechanism],
  };
  return [
    ...new Set([
      ...readinessErrors,
      ...validateForFabrication(candidateProject).errors.filter(
        (error) => !baseline.has(error),
      ),
    ]),
  ];
};

export const normalizeGearMeshMechanism = (
  mechanism: MechanismConfig,
): MechanismConfig => {
  return normalizeMechanismToFabricationSet(mechanism);
};

const availableMotionAnchorForRecommendation = (
  project: ProjectState,
  partId: string,
) => {
  const anchors = motionAnchorJointIds(project, partId);
  const occupied = new Set(
    project.mechanisms
      .filter(
        (m) => m.visible && m.enabled !== false && m.targetPartId === partId,
      )
      .map((m) =>
        preferredMotionJointId(project, partId, m.targetAnchorJointId),
      )
      .filter(Boolean),
  );
  return (
    [...anchors].reverse().find((anchor) => !occupied.has(anchor)) ??
    preferredMotionJointId(project, partId, undefined, {
      preferDistalWhenRoot: true,
    })
  );
};

const recommendationTargetAnchor = (
  project: ProjectState,
  selectedPart: BodyPartLayer,
  selectedPath: ProjectMotionPath,
) => {
  const anchors = motionAnchorJointIds(project, selectedPart.id);
  const pathAnchor =
    selectedPath.targetAnchorJointId &&
    anchors.includes(selectedPath.targetAnchorJointId)
      ? selectedPath.targetAnchorJointId
      : undefined;
  const occupied = new Set(
    project.mechanisms
      .filter(
        (m) =>
          m.visible &&
          m.enabled !== false &&
          m.targetPartId === selectedPart.id,
      )
      .map((m) =>
        preferredMotionJointId(
          project,
          selectedPart.id,
          m.targetAnchorJointId ??
            (m.targetPathId
              ? project.paths[m.targetPathId]?.targetAnchorJointId
              : undefined),
        ),
      )
      .filter(Boolean),
  );
  if (pathAnchor && !occupied.has(pathAnchor)) return pathAnchor;
  return (
    availableMotionAnchorForRecommendation(project, selectedPart.id) ??
    pathAnchor ??
    preferredMotionJointId(project, selectedPart.id, undefined, {
      preferDistalWhenRoot: true,
    })
  );
};

const createRecommendedMechanism = (
  project: ProjectState,
  selectedPart: BodyPartLayer | undefined,
  selectedPath: ProjectMotionPath,
  type: MechanismType,
  reason: string,
  score: number,
): MechanismConfig => {
  const metrics = pathMetrics(selectedPath);
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
    targetPartId: selectedPart?.id,
    targetSceneObjectId: selectedPath.sceneObjectId,
    targetPathId: selectedPath.id,
    targetAnchorJointId: selectedPart
      ? recommendationTargetAnchor(project, selectedPart, selectedPath)
      : undefined,
    activeVisualPartIds: selectedPart ? [selectedPart.id] : [],
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
      targetPartId: path?.sceneObjectId ? undefined : (path?.partId ?? mechanism.targetPartId),
      targetSceneObjectId: path?.sceneObjectId ?? mechanism.targetSceneObjectId,
      targetPathId: path?.id ?? mechanism.targetPathId,
      targetAnchorJointId:
        path?.sceneObjectId ? undefined : (mechanism.targetAnchorJointId ?? path?.targetAnchorJointId),
      activeVisualPartIds:
        !path?.sceneObjectId && (path?.partId || mechanism.targetPartId)
          ? [path?.partId ?? mechanism.targetPartId!]
          : (mechanism.activeVisualPartIds ?? []),
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
  const fitted = createRecommendedMechanism(
    project,
    part,
    path,
    mechanism.type,
    mechanism.recommendation ?? "Fit",
    80,
  );
  const fittedCandidate = localizeFittedMechanismAnchor(
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
      targetPartId: path.sceneObjectId ? undefined : path.partId,
      targetSceneObjectId: path.sceneObjectId,
      targetPathId: path.id,
      targetAnchorJointId:
        path.sceneObjectId
          ? undefined
          : (mechanism.targetAnchorJointId ??
            path.targetAnchorJointId ??
            fitted.targetAnchorJointId),
      activeVisualPartIds: path.sceneObjectId ? [] : [path.partId],
    }),
    Number.isFinite(mechanism.anchorX) && Number.isFinite(mechanism.anchorY)
      ? { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }
      : undefined,
  );
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
        ...fittedErrors,
        ...fallbackErrors,
        ...unchangedErrors,
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
      const initialErrors = fabricationErrorsForCandidate(
        project,
        initialMechanism,
      );
      const mechanism = initialErrors.length
        ? fitRecommendedMechanismToSheet(
            project,
            readyMechanismFallbackForPath(
              project,
              initialMechanism,
              selectedPath,
            ),
          )
        : initialMechanism;
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
          ? `Blocked: ${fabricationErrors[0]}`
          : (range.warning ?? "360°"),
        fabricationErrors,
      };
    })
    .filter((option) => option.fabricationErrors.length === 0)
    .sort((a, b) => b.score - a.score);
};
