import type { AppSettings, MechanismConfig, Point } from '../types';
import { buildPreparedFoundryPhysicsOverlay } from './physicsSession';
import {
  generatePreparedCurvePoints,
  prepareMechanismKinematics,
  type PreparedMechanismKinematics,
} from './kinematics';
import {
  createPreparedFoundryPlaybackFrame,
  generatePreparedFoundryPlaybackPointTraces,
} from './foundryPlayback';
import {
  createPreparedMechanismFitContext,
  createPreparedSceneMechanismFitContext,
  pointsToSvgPath,
  type MechanismFitContext,
  type MechanismPreviewSimulation,
} from './mechanismPreview';

export type FoundryMechanismPreviewModel = {
  mechanism: MechanismConfig;
  pointTraces: Array<{ id: string; label: string; points: Point[]; primary: boolean }>;
  previewPoints: Point[];
  userPathPoints: Point[];
  physicalSimulation: MechanismPreviewSimulation;
  physicsOverlay: ReturnType<typeof buildPreparedFoundryPhysicsOverlay>;
};

export type PreparedFoundryMechanismPreviewModel = {
  mechanism: MechanismConfig;
  settings: AppSettings;
  kinematics: PreparedMechanismKinematics;
  context: MechanismFitContext;
  pointTraces: FoundryMechanismPreviewModel['pointTraces'];
  previewPoints: Point[];
  previewPathD: string;
  userPathPoints: Point[];
};

export type PrepareFoundryMechanismPreviewOptions = {
  mechanism: MechanismConfig;
  settings: AppSettings;
  userPathPoints?: Point[];
  width?: number;
  height?: number;
  resolution?: number;
  frame?: 'fit' | 'scene';
  kinematics?: PreparedMechanismKinematics;
};

export const prepareFoundryMechanismPreviewModel = ({
  mechanism,
  settings,
  userPathPoints = [],
  width = 360,
  height = 240,
  resolution = 96,
  frame = 'fit',
  kinematics: suppliedKinematics,
}: PrepareFoundryMechanismPreviewOptions): PreparedFoundryMechanismPreviewModel => {
  const kinematics = suppliedKinematics
    ?? prepareMechanismKinematics(mechanism, settings.physicalKit);
  if (
    kinematics.mechanism !== mechanism
    || kinematics.kit !== settings.physicalKit
  ) {
    throw new Error('Prepared Foundry kinematics do not match the authoritative mechanism and kit');
  }
  const context = frame === 'scene'
    ? createPreparedSceneMechanismFitContext(
        kinematics,
        width,
        height,
        resolution,
      )
    : createPreparedMechanismFitContext(
        kinematics,
        width,
        height,
        resolution,
        userPathPoints,
      );
  const rawTraces = generatePreparedFoundryPlaybackPointTraces(
    kinematics,
    resolution,
  ).traces;
  const pointTraces = rawTraces.map((trace) => ({
    ...trace,
    points: trace.points.map(context.map),
  }));
  const fallbackPreview = generatePreparedCurvePoints(
    kinematics,
    resolution,
  ).points.map(context.map);
  const previewPoints =
    pointTraces.find((trace) => trace.primary)?.points ??
    pointTraces[0]?.points ??
    fallbackPreview;
  return {
    mechanism: kinematics.mechanism,
    settings,
    kinematics,
    context,
    pointTraces,
    previewPoints,
    previewPathD: pointsToSvgPath(previewPoints),
    userPathPoints: userPathPoints.map(context.map),
  };
};

export const samplePreparedFoundryMechanismPreviewModel = (
  prepared: PreparedFoundryMechanismPreviewModel,
  playbackPhaseRad: number,
): FoundryMechanismPreviewModel => {
  const playbackFrame = createPreparedFoundryPlaybackFrame(
    prepared.kinematics,
    playbackPhaseRad,
    prepared.context,
  );
  const physicalSimulation = {
    ...playbackFrame.simulation,
    pathPoints: prepared.previewPoints,
    pathD: prepared.previewPathD,
  };
  return {
    mechanism: prepared.mechanism,
    pointTraces: prepared.pointTraces,
    previewPoints: prepared.previewPoints,
    userPathPoints: prepared.userPathPoints,
    physicalSimulation,
    physicsOverlay: buildPreparedFoundryPhysicsOverlay(
      prepared.kinematics,
      physicalSimulation,
      playbackFrame.playbackPhaseRad,
      prepared.settings,
      prepared.previewPoints,
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
): FoundryMechanismPreviewModel => samplePreparedFoundryMechanismPreviewModel(
  prepareFoundryMechanismPreviewModel({
    mechanism,
    settings,
    userPathPoints,
    width,
    height,
    resolution,
    frame,
  }),
  playbackPhaseRad,
);
