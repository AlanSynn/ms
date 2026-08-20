import type { AppSettings, MechanismConfig, Point } from '../types';
import { buildFoundryPhysicsOverlay } from './physicsSession';
import { generateCurvePoints } from './kinematics';
import { createFoundryPlaybackFrame, generateFoundryPlaybackPointTraces } from './foundryPlayback';
import {
  createMechanismFitContext,
  createSceneMechanismFitContext,
  pointsToSvgPath,
  type MechanismFitContext,
  type MechanismPreviewSimulation,
} from './mechanismPreview';
import { normalizeGearMeshMechanism } from './mechanismRecommendations';

export type FoundryMechanismPreviewModel = {
  mechanism: MechanismConfig;
  pointTraces: Array<{ id: string; label: string; points: Point[]; primary: boolean }>;
  previewPoints: Point[];
  userPathPoints: Point[];
  physicalSimulation: MechanismPreviewSimulation;
  physicsOverlay: ReturnType<typeof buildFoundryPhysicsOverlay>;
};

export type FoundryMechanismPreviewRuntime = {
  mechanism: MechanismConfig;
  settings: AppSettings;
  context: MechanismFitContext;
  pointTraces: FoundryMechanismPreviewModel['pointTraces'];
  previewPoints: Point[];
  userPathPoints: Point[];
};

export const createFoundryMechanismPreviewRuntime = (
  mechanism: MechanismConfig,
  settings: AppSettings,
  userPathPoints: Point[] = [],
  width = 360,
  height = 240,
  resolution = 96,
  frame: 'fit' | 'scene' = 'fit',
): FoundryMechanismPreviewRuntime => {
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
  const fallbackPreview = generateCurvePoints(
    normalizedMechanism,
    resolution,
  ).points.map(context.map);
  const previewPoints =
    pointTraces.find((trace) => trace.primary)?.points ??
    pointTraces[0]?.points ??
    fallbackPreview;
  return {
    mechanism: normalizedMechanism,
    settings,
    context,
    pointTraces,
    previewPoints,
    userPathPoints: userPathPoints.map(context.map),
  };
};

export const sampleFoundryMechanismPreviewRuntime = (
  runtime: FoundryMechanismPreviewRuntime,
  playbackPhaseRad: number,
): FoundryMechanismPreviewModel => {
  const playbackFrame = createFoundryPlaybackFrame(
    runtime.mechanism,
    playbackPhaseRad,
    runtime.context,
  );
  const physicalSimulation = {
    ...playbackFrame.simulation,
    pathPoints: runtime.previewPoints,
    pathD: pointsToSvgPath(runtime.previewPoints),
  };
  return {
    mechanism: runtime.mechanism,
    pointTraces: runtime.pointTraces,
    previewPoints: runtime.previewPoints,
    userPathPoints: runtime.userPathPoints,
    physicalSimulation,
    physicsOverlay: buildFoundryPhysicsOverlay(
      runtime.mechanism,
      physicalSimulation,
      playbackFrame.playbackPhaseRad,
      runtime.settings,
      runtime.previewPoints,
    ),
  };
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
): FoundryMechanismPreviewModel =>
  sampleFoundryMechanismPreviewRuntime(
    createFoundryMechanismPreviewRuntime(
      mechanism,
      settings,
      userPathPoints,
      width,
      height,
      resolution,
      frame,
    ),
    playbackPhaseRad,
  );
