import assert from 'node:assert/strict';

import { foundryMechanismForHandleGesture } from '../components/stages/foundry/foundryHandleGesture';
import { calculateLinkage } from '../utils/kinematics';
import { createDefaultMechanism } from '../utils/project';
import { defaultPhysicalKit } from '../utils/coordinates';

const mechanism = {
  ...createDefaultMechanism('4bar', 'foundry-gesture'),
  anchorX: 0,
  anchorY: 0,
};
const simulation = {
  state: calculateLinkage(mechanism, 0),
  scale: 1,
};
const kit = defaultPhysicalKit();

const crank = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'B',
  point: { x: simulation.state.p1.x + 120, y: simulation.state.p1.y },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(crank.crankLength, 120, 'B changes only the bounded crank length');
assert.equal(crank.groundLength, mechanism.groundLength);

const ground = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'D',
  point: { x: simulation.state.p1.x, y: simulation.state.p1.y + 160 },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(ground.groundLength, 160, 'D changes the ground-link length');
assert.equal(ground.groundAngle, 90, 'D changes the ground-link angle');

const coupler = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'C',
  point: {
    x: simulation.state.j1.x + 80,
    y: simulation.state.j1.y,
  },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(coupler.couplerLength, 80, 'C changes the coupler length');
assert(Number.isFinite(coupler.rockerLength), 'C keeps a finite rocker length');

const moved = foundryMechanismForHandleGesture({
  mechanism,
  handle: 'M',
  point: {
    x: simulation.state.p1.x + kit.gridPitchMm * 2,
    y: simulation.state.p1.y,
  },
  simulation,
  landing: { x: 0, y: 0 },
  kit,
});
assert.equal(moved.anchorX, moved.sceneAnchor?.x, 'M keeps anchor and scene anchor aligned');
assert.equal(moved.anchorY, moved.sceneAnchor?.y, 'M keeps anchor and scene anchor aligned');
assert.equal(moved.transform?.x, moved.anchorX, 'M keeps the transform on the snapped anchor');

console.log('Foundry handle gesture contract ok');
