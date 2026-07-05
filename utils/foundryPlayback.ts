import type { MechanismConfig } from '../types';
import {
  calculateLinkage,
  mechanismTraceDefinitionsForState,
  planetaryCarrierOutputRatio,
  planetaryPlanetSpinRatio,
  type MechanismPointTrace,
} from './kinematics';
import {
  fitMechanismSimulationWithContext,
  type MechanismFitContext,
  type MechanismPreviewSimulation,
} from './mechanismPreview';

export type FoundryPlaybackFrame = {
  playbackPhaseRad: number;
  inputAngleRad: number;
  simulation: MechanismPreviewSimulation;
};

export const foundryPlaybackPhaseToInputAngle = (
  mechanism: Pick<
    MechanismConfig,
    'type' | 'crankLength' | 'rockerLength' | 'speed1' | 'driverPhaseOffset'
  >,
  playbackPhaseRad: number,
) => {
  if (mechanism.type !== 'planetary_gear') return playbackPhaseRad;
  const carrierRatio = Math.max(
    0.001,
    Math.abs(
      planetaryCarrierOutputRatio(
        mechanism.crankLength,
        mechanism.rockerLength,
      ),
    ),
  );
  const speed = mechanism.speed1 ?? 1;
  const solverInputSpeed = Math.abs(speed) < 0.001 ? 1 : speed;
  const desiredSunInputAngle = playbackPhaseRad / carrierRatio;
  return (
    (desiredSunInputAngle - (mechanism.driverPhaseOffset ?? 0)) /
    solverInputSpeed
  );
};

export const createFoundryPlaybackFrame = (
  mechanism: MechanismConfig,
  playbackPhaseRad: number,
  context: MechanismFitContext,
): FoundryPlaybackFrame => {
  const inputAngleRad = foundryPlaybackPhaseToInputAngle(
    mechanism,
    playbackPhaseRad,
  );
  return {
    playbackPhaseRad,
    inputAngleRad,
    simulation: fitMechanismSimulationWithContext(
      mechanism,
      inputAngleRad,
      context,
    ),
  };
};

export const foundryPlanetaryPlanetRotationDeg = (
  mechanism: Pick<MechanismConfig, 'crankLength' | 'rockerLength' | 'phase'>,
  driveAngleDeg: number,
  planetIndex = 0,
  planetCount = 1,
) =>
  driveAngleDeg *
    planetaryPlanetSpinRatio(mechanism.crankLength, mechanism.rockerLength) +
  (((mechanism.phase ?? 0) * 180) / Math.PI) +
  planetIndex * (360 / Math.max(1, planetCount));

const foundryPlaybackTraceLoops = (mechanism: MechanismConfig) =>
  mechanism.type === '5bar' || mechanism.type === '6bar' ? 8 : 1;

/**
 * Physical traces shown by Foundry must sample the same visible playback phase
 * as the current frame. Planetary gears are the important special case: one
 * visible carrier cycle requires multiple raw sun-input rotations, so raw
 * solver-angle traces make the path/physics overlay drift from the rendered
 * mechanism.
 */
export const generateFoundryPlaybackPointTraces = (
  mechanism: MechanismConfig,
  resolution = 36,
): { traces: MechanismPointTrace[]; percentValid: number } => {
  const samplesPerCycle = Math.max(1, Math.floor(resolution));
  const loops = foundryPlaybackTraceLoops(mechanism);
  const totalSamples = samplesPerCycle * loops;
  const traces = new Map<string, MechanismPointTrace>();
  let validCount = 0;

  for (let i = 0; i < totalSamples; i += 1) {
    const playbackPhaseRad = (i / samplesPerCycle) * Math.PI * 2;
    const inputAngleRad = foundryPlaybackPhaseToInputAngle(
      mechanism,
      playbackPhaseRad,
    );
    const state = calculateLinkage(mechanism, inputAngleRad);
    if (!state.isValid) continue;
    validCount += 1;
    mechanismTraceDefinitionsForState(mechanism.type, state).forEach((def) => {
      if (
        !def.point ||
        !Number.isFinite(def.point.x) ||
        !Number.isFinite(def.point.y)
      )
        return;
      const trace = traces.get(def.id) ?? {
        id: def.id,
        label: def.label,
        points: [],
        primary: Boolean(def.primary),
      };
      trace.primary = trace.primary || Boolean(def.primary);
      trace.points.push(def.point);
      traces.set(def.id, trace);
    });
  }

  const allTraces = [...traces.values()].filter(
    (trace) => trace.points.length > 1,
  );
  if (allTraces.length && !allTraces.some((trace) => trace.primary))
    allTraces[allTraces.length - 1].primary = true;
  return { traces: allTraces, percentValid: validCount / totalSamples };
};
