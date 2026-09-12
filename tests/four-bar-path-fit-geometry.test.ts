import assert from 'node:assert/strict';

import {
  clearFourBarFitCache,
  fitFourBarKitMechanismToPath,
  resamplePathForFourBarFit,
  targetTangentForFourBarFit,
} from '../utils/fourBarPathFit';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';

const near = (actual: number, expected: number, message: string, epsilon = 1e-9) =>
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} versus ${expected}`);

const nearPoint = (
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  message: string,
) => {
  near(actual.x, expected.x, `${message} x`);
  near(actual.y, expected.y, `${message} y`);
};

const pathDistance = (points: Array<{ x: number; y: number }>) =>
  points.reduce(
    (sum, point, index) =>
      sum + Math.hypot(
        point.x - points[(index + 1) % points.length].x,
        point.y - points[(index + 1) % points.length].y,
      ),
    0,
  );

// A closed polyline is sampled as a ring: count positions at i/count of the
// perimeter, with the closing edge included and no duplicated endpoint.
const circleVertices = Array.from({ length: 8 }, (_, index) => ({
  x: 10 * Math.cos((index / 8) * Math.PI * 2),
  y: 10 * Math.sin((index / 8) * Math.PI * 2),
}));
const circleSamples = resamplePathForFourBarFit(circleVertices, 16, 'closed');
assert.equal(circleSamples.length, 16, 'closed circle keeps the requested sample count');
nearPoint(circleSamples[0], circleVertices[0], 'closed circle starts at the authored first point');
assert(
  Math.hypot(circleSamples.at(-1)!.x - circleSamples[0].x, circleSamples.at(-1)!.y - circleSamples[0].y) > 1,
  'closed circle does not duplicate its endpoint',
);
const circleStep = pathDistance(circleSamples) / circleSamples.length;
for (let index = 0; index < circleSamples.length; index += 1) {
  near(
    Math.hypot(
      circleSamples[index].x - circleSamples[(index + 1) % circleSamples.length].x,
      circleSamples[index].y - circleSamples[(index + 1) % circleSamples.length].y,
    ),
    circleStep,
    `closed circle has uniform ring spacing at ${index}`,
  );
}
nearPoint(
  circleSamples[1],
  { x: 8.535533905932738, y: 3.5355339059327378 },
  'closed circle samples half-way along its first polygon edge',
);

// Tangents use the same explicit topology as resampling. On a regular circle,
// the centered secant at each vertex is the analytic tangent (-sin(theta),
// cos(theta)), including the wraparound seam at the first and last points.
for (const index of [0, 1, 6, 7]) {
  const theta = (index / circleVertices.length) * Math.PI * 2;
  const tangent = targetTangentForFourBarFit(circleVertices, index, 'closed');
  assert(tangent, `closed circle tangent exists at ${index}`);
  nearPoint(
    tangent,
    { x: -Math.sin(theta), y: Math.cos(theta) },
    `closed circle tangent is analytic at ${index}`,
  );
}

// The same nonduplicated samples are open: the first and last tangents use
// only their adjacent segment, rather than wrapping across the seam.
const openCircleFirstTangent = targetTangentForFourBarFit(circleVertices, 0, 'open');
const openCircleLastTangent = targetTangentForFourBarFit(
  circleVertices,
  circleVertices.length - 1,
  'open',
);
assert(openCircleFirstTangent && openCircleLastTangent, 'open circle endpoint tangents exist');
nearPoint(
  openCircleFirstTangent,
  { x: Math.cos((5 * Math.PI) / 8), y: Math.sin((5 * Math.PI) / 8) },
  'open circle first tangent is one-sided',
);
nearPoint(
  openCircleLastTangent,
  { x: Math.cos(Math.PI / 8), y: Math.sin(Math.PI / 8) },
  'open circle last tangent is one-sided',
);
assert(
  Math.hypot(
    openCircleFirstTangent.x - (-Math.sin(0)),
    openCircleFirstTangent.y - Math.cos(0),
  ) > 0.1,
  'open circle first tangent does not use the closed seam tangent',
);

const repeatedOpenCircle = [...circleVertices, circleVertices[0]];
const repeatedOpenLastTangent = targetTangentForFourBarFit(
  repeatedOpenCircle,
  repeatedOpenCircle.length - 1,
  'open',
);
assert(repeatedOpenLastTangent, 'repeated-endpoint open tangent exists');
nearPoint(
  repeatedOpenLastTangent,
  { x: Math.cos((3 * Math.PI) / 8), y: Math.sin((3 * Math.PI) / 8) },
  'repeated-endpoint open path remains one-sided at its final point',
);

// A rectangle makes the wraparound segment and corner positions explicit.
const polygonSamples = resamplePathForFourBarFit(
  [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 0, y: 2 },
  ],
  8,
  'closed',
);
assert.deepEqual(
  polygonSamples.map(({ x, y }) => [Number(x.toFixed(9)), Number(y.toFixed(9))]),
  [
    [0, 0],
    [1.5, 0],
    [3, 0],
    [4, 0.5],
    [4, 2],
    [2.5, 2],
    [1, 2],
    [0, 1.5],
  ],
  'closed polygon samples each perimeter interval and wraps its final edge',
);
assert.equal(
  polygonSamples.filter((point) => point.x === 0 && point.y === 0).length,
  1,
  'closed polygon includes its starting position once',
);

// An explicitly open path keeps endpoint-inclusive sampling even when the
// authored points happen to repeat the first point at the seam.
const openSeamSamples = resamplePathForFourBarFit(
  [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 0 },
  ],
  5,
  'open',
);
assert.deepEqual(
  openSeamSamples.map(({ x, y }) => [Number(x.toFixed(9)), Number(y.toFixed(9))]),
  [
    [0, 0],
    [3, 0],
    [4, 2],
    [1, 2],
    [0, 0],
  ],
  'open seam retains endpoint-inclusive positions and does not add a closing span',
);
assert.equal(openSeamSamples.length, 5, 'open seam keeps the requested sample count');
nearPoint(openSeamSamples[0], openSeamSamples.at(-1)!, 'open seam retains its authored endpoint');

// The physical C trace is a representative closed-path fit. Its geometry and
// positional metrics stay fixed while explicit closed tangents remove the
// artificial one-sided seam penalty.
clearFourBarFitCache();
const fixture = createFabricationReadyFourBarProject();
const closedPath = fixture.paths['fabrication-fit-path'];
const closedFit = fixture.mechanisms[0];
const closedMetrics = closedFit.fabricationMetadata?.pathFit;
assert.equal(closedPath.closed, true, 'representative fixture is explicitly closed');
assert.equal(closedPath.points.length, 96, 'representative authored trace keeps 96 points');
assert.equal(closedFit.generatedPath?.length, 96, 'representative generated trace keeps 96 points');
assert.equal(closedMetrics?.status, 'fit', 'representative closed path remains fabrication-fit');
assert.equal(closedMetrics?.outputTraceId, 'C', 'representative fit keeps the physical C output');
near(closedFit.groundLength, 320, 'representative ground length');
near(closedFit.crankLength, 80, 'representative crank length');
near(closedFit.couplerLength, 320, 'representative coupler length');
near(closedFit.rockerLength, 80, 'representative rocker length');
near(closedMetrics?.phaseOffset ?? Number.NaN, 0, 'representative closed fit phase');
assert.equal(closedMetrics?.direction, 1, 'representative closed fit direction');
near(closedMetrics?.error ?? Number.NaN, 0.45089584819069023, 'representative positional RMS');
near(closedMetrics?.maxError ?? Number.NaN, 0.901065859280021, 'representative maximum positional error');
near(closedMetrics?.tangentError ?? Number.NaN, 7.256880443822208, 'representative tangent RMS');
near(closedMetrics?.maxTangentError ?? Number.NaN, 35.353247284645114, 'representative maximum tangent error');

// The same seam is explicitly open. It keeps endpoint tangents one-sided even
// though the first and last authored points are equal, so its fit diagnostics
// intentionally differ from the closed ring.
const openPath = {
  ...closedPath,
  id: 'fabrication-fit-open-seam',
  points: [...closedPath.points, closedPath.points[0]],
  closed: false,
};
clearFourBarFitCache();
const openFit = fitFourBarKitMechanismToPath(
  { ...fixture, mechanisms: [], paths: { [openPath.id]: openPath } },
  { ...closedFit, id: 'fabrication-fit-open-seam-mechanism', outputs: undefined },
  openPath,
);
const openMetrics = openFit?.fabricationMetadata?.pathFit;
assert.equal(openMetrics?.status, 'fit', 'explicitly open seam remains fit-capable');
assert.equal(openMetrics?.outputTraceId, 'C', 'explicitly open seam keeps the physical C output');
near(openMetrics?.phaseOffset ?? Number.NaN, 0.19634954084936207, 'explicitly open seam phase');
assert.equal(openMetrics?.direction, 1, 'explicitly open seam direction');
near(openMetrics?.error ?? Number.NaN, 8.151231264138497, 'explicitly open seam positional RMS');
near(openMetrics?.tangentError ?? Number.NaN, 5.65891832074538, 'explicitly open seam one-sided tangent RMS');
assert.notEqual(openMetrics?.phaseOffset, closedMetrics?.phaseOffset, 'open and closed topology remain distinct at the seam');

console.log('four-bar path-fit geometry contract passed');
