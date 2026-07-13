import type { Point, ProjectMotionPath } from "../types";
import {
  gearTrainMeshPhaseRadAt,
  gearTrainRotationRatioAt,
} from "./kinematics";

type TimedPoint = NonNullable<ProjectMotionPath["timedPoints"]>[number];

const GUIDED_PHASE_SAMPLE_COUNT = 24;

const timedCycle = (points: Point[], duration: number): TimedPoint[] =>
  points.map((point, index) => ({
    ...point,
    time: (index / points.length) * duration,
  }));

// Authored phase keyframes for the fabrication-valid classroom four-bar.
// They stay independent of runtime generatedPath sampling so kinematic drift
// fails the guided-lesson integration contract instead of rewriting the input.
const GUIDED_FOUR_BAR_PHASE_OFFSETS: Point[] = [
  { x: 24, y: -121.589 },
  { x: 18.566369, y: -107.413995 },
  { x: 14.782438, y: -96.136567 },
  { x: 12.29594, y: -87.85335 },
  { x: 10.801302, y: -82.438855 },
  { x: 10.09272, y: -79.733794 },
  { x: 10.07945, y: -79.682199 },
  { x: 10.795946, y: -82.418765 },
  { x: 12.430967, y: -88.32491 },
  { x: 15.388972, y: -98.041428 },
  { x: 20.367181, y: -112.339546 },
  { x: 28.322851, y: -131.622342 },
  { x: 40, y: -154.919334 },
  { x: 54.830765, y: -179.123636 },
  { x: 70.197981, y: -199.997378 },
  { x: 82.493432, y: -214.454261 },
  { x: 89.107495, y: -221.559588 },
  { x: 89.342492, y: -221.804224 },
  { x: 84.038197, y: -216.152787 },
  { x: 74.815397, y: -205.631979 },
  { x: 63.484413, y: -191.31062 },
  { x: 51.689361, y: -174.382915 },
  { x: 40.710492, y: -156.196577 },
  { x: 31.365841, y: -138.167733 },
];

export const guidedFourBarTimedPoints = (
  anchor: Point,
  duration: number,
): TimedPoint[] =>
  timedCycle(
    GUIDED_FOUR_BAR_PHASE_OFFSETS.map((offset) => ({
      x: anchor.x + offset.x,
      y: anchor.y + offset.y,
    })),
    duration,
  );

export const guidedHeadBobTimedPoints = (
  headTop: Point,
  duration: number,
): TimedPoint[] => {
  const offsets = [
    -4.8, -4.4, -4, -3.6, -3.2, -2.8, -2.4, -2, -1.6, -1.2, -0.8,
    -0.4, 0, -0.4, -0.8, -1.2, -1.6, -2, -2.4, -2.8, -3.2, -3.6,
    -4, -4.4,
  ];
  const cycle = timedCycle(
    offsets.map((offsetY) => ({ x: headTop.x, y: headTop.y + offsetY })),
    duration,
  );
  return [...cycle, { ...cycle[0], time: duration }];
};

export const guidedGearDriverPhaseOffset = (radii: number[]): number => {
  const outputIndex = radii.length - 1;
  const outputRatio = gearTrainRotationRatioAt(radii, outputIndex);
  const meshPhase = gearTrainMeshPhaseRadAt(radii, outputIndex);
  return Math.abs(outputRatio) > 1e-9 ? -meshPhase / outputRatio : 0;
};

export const guidedGearTimedPoints = (
  outputCenter: Point,
  radii: number[],
  outputRadius: number,
  duration: number,
): TimedPoint[] => {
  const outputIndex = radii.length - 1;
  const outputRatio = gearTrainRotationRatioAt(radii, outputIndex);
  const meshPhase = gearTrainMeshPhaseRadAt(radii, outputIndex);
  const driverPhaseOffset = guidedGearDriverPhaseOffset(radii);
  return timedCycle(
    Array.from({ length: GUIDED_PHASE_SAMPLE_COUNT }, (_, index) => {
      const inputPhase =
        driverPhaseOffset +
        (index / GUIDED_PHASE_SAMPLE_COUNT) * Math.PI * 2;
      const outputPhase = meshPhase + inputPhase * outputRatio;
      return {
        x: outputCenter.x + outputRadius * Math.cos(outputPhase),
        y: outputCenter.y + outputRadius * Math.sin(outputPhase),
      };
    }),
    duration,
  );
};
