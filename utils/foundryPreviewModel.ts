import type { AppSettings, MechanismConfig, Point } from '../types';
import { buildFoundryPhysicsOverlay } from './physicsSession';
import { generateCurvePoints } from './kinematics';
import { createFoundryPlaybackFrame, generateFoundryPlaybackPointTraces } from './foundryPlayback';
import { createMechanismFitContext, createSceneMechanismFitContext, pointsToSvgPath, type MechanismPreviewSimulation } from './mechanismPreview';
import { normalizeGearMeshMechanism } from './mechanismRecommendations';

export type FoundryMechanismPreviewModel = {
  mechanism: MechanismConfig;
  pointTraces: Array<{ id: string; label: string; points: Point[]; primary: boolean }>;
  previewPoints: Point[];
  userPathPoints: Point[];
  physicalSimulation: MechanismPreviewSimulation;
  physicsOverlay: ReturnType<typeof buildFoundryPhysicsOverlay>;
};

export const buildFoundryMechanismPreviewModel = (
  mechanism: MechanismConfig,
  playbackPhaseRad: number,
  settings: AppSettings,
  userPathPoints: Point[] = [],
  width = 360,
  height = 240,
  resolution = 96,
  frame: 'fit' | 'scene' = 'fit',
): FoundryMechanismPreviewModel => {
  const normalizedMechanism = normalizeGearMeshMechanism(mechanism);
  const context = frame === 'scene'
    ? createSceneMechanismFitContext(normalizedMechanism, width, height, resolution)
    : createMechanismFitContext(
        normalizedMechanism,
        width,
        height,
        resolution,
        userPathPoints,
      );
  const rawTraces = generateFoundryPlaybackPointTraces(
    normalizedMechanism,
    resolution,
  ).traces;
  const pointTraces = rawTraces.map((trace) => ({
    ...trace,
    points: trace.points.map(context.map),
  }));
  const fallbackPreview = generateCurvePoints(normalizedMechanism, resolution).points.map(context.map);
  const previewPoints =
    pointTraces.find((trace) => trace.primary)?.points ??
    pointTraces[0]?.points ??
    fallbackPreview;
  const playbackFrame = createFoundryPlaybackFrame(
    normalizedMechanism,
    playbackPhaseRad,
    context,
  );
  const physicalSimulation = {
    ...playbackFrame.simulation,
    pathPoints: previewPoints,
    pathD: pointsToSvgPath(previewPoints),
  };
  return {
    mechanism: normalizedMechanism,
    pointTraces,
    previewPoints,
    userPathPoints: userPathPoints.map(context.map),
    physicalSimulation,
    physicsOverlay: buildFoundryPhysicsOverlay(
      normalizedMechanism,
      physicalSimulation,
      playbackFrame.playbackPhaseRad,
      settings,
      previewPoints,
    ),
  };
};
