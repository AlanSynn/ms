import type { AppSettings, MechanismConfig, Point } from '../types';
import { buildFoundryPhysicsOverlay } from './physicsSession';
import { generateCurvePoints } from './kinematics';
import { createFoundryPlaybackFrame, generateFoundryPlaybackPointTraces } from './foundryPlayback';
import { createMechanismFitContext, createSceneMechanismFitContext, pointsToSvgPath, type MechanismPreviewSimulation } from './mechanismPreview';

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
  const context = frame === 'scene'
    ? createSceneMechanismFitContext(
        mechanism,
        width,
        height,
        resolution,
        settings.physicalKit,
      )
    : createMechanismFitContext(
        mechanism,
        width,
        height,
        resolution,
        userPathPoints,
        settings.physicalKit,
      );
  const rawTraces = generateFoundryPlaybackPointTraces(
    mechanism,
    resolution,
    settings.physicalKit,
  ).traces;
  const pointTraces = rawTraces.map((trace) => ({
    ...trace,
    points: trace.points.map(context.map),
  }));
  const fallbackPreview = generateCurvePoints(
    mechanism,
    resolution,
    settings.physicalKit,
  ).points.map(context.map);
  const previewPoints =
    pointTraces.find((trace) => trace.primary)?.points ??
    pointTraces[0]?.points ??
    fallbackPreview;
  const playbackFrame = createFoundryPlaybackFrame(
    mechanism,
    playbackPhaseRad,
    context,
    settings.physicalKit,
  );
  const physicalSimulation = {
    ...playbackFrame.simulation,
    pathPoints: previewPoints,
    pathD: pointsToSvgPath(previewPoints),
  };
  return {
    mechanism,
    pointTraces,
    previewPoints,
    userPathPoints: userPathPoints.map(context.map),
    physicalSimulation,
    physicsOverlay: buildFoundryPhysicsOverlay(
      mechanism,
      physicalSimulation,
      playbackFrame.playbackPhaseRad,
      settings,
      previewPoints,
    ),
  };
};
