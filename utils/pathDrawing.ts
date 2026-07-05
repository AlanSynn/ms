import type { Point } from "../types";

export type DrawSamplePoint = Point & { time: number };
export type DrawTimedPoint = Point & { time: number };

const MIN_DRAW_POINT_DISTANCE = 8;
const DRAW_JITTER_DISTANCE = 2.5;
const SLOW_DRAW_SAMPLE_MS = 80;
const MAX_DRAW_SEGMENT_DISTANCE = 28;
const MAX_DRAW_POINTS = 900;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const between = (a: DrawSamplePoint, b: DrawSamplePoint, t: number): DrawSamplePoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  time: a.time + (b.time - a.time) * t,
});

export const addDrawSamplePoint = (
  draft: DrawSamplePoint[] | null | undefined,
  point: Point,
  time: number,
  replace = false,
): DrawSamplePoint[] => {
  const base = replace ? [] : draft ?? [];
  const sample = { x: point.x, y: point.y, time };
  const last = base.at(-1);
  if (!last) return [sample];
  const segmentDistance = distance(last, sample);
  if (segmentDistance < DRAW_JITTER_DISTANCE) return base;
  if (segmentDistance < MIN_DRAW_POINT_DISTANCE && sample.time - last.time < SLOW_DRAW_SAMPLE_MS) return base;
  const stepCount = Math.max(1, Math.ceil(segmentDistance / MAX_DRAW_SEGMENT_DISTANCE));
  const added = Array.from({ length: stepCount }, (_, index) =>
    between(last, sample, (index + 1) / stepCount),
  );
  return [...base, ...added].slice(-MAX_DRAW_POINTS);
};

export const normalizeDrawTimedPoints = (
  draft: DrawSamplePoint[],
  duration: number,
  options: { closed?: boolean } = {},
): DrawTimedPoint[] => {
  if (draft.length === 0) return [];
  const start = draft[0].time;
  const elapsed = Math.max(1, (draft.at(-1)?.time ?? start) - start);
  const safeDuration = Math.max(1, duration);
  const drawnDuration = options.closed && draft.length > 1 ? safeDuration * 0.85 : safeDuration;
  return draft.map((point) => ({
    x: point.x,
    y: point.y,
    time: draft.length <= 1 ? 0 : ((point.time - start) / elapsed) * drawnDuration,
  }));
};
