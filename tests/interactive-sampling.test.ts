import { strict as assert } from 'node:assert';

import { sampleIndexedValues } from '../utils/interactiveSampling';

const source = Array.from({ length: 1000 }, (_, index) => ({ x: index, y: index * 2 }));
const sampled = sampleIndexedValues(source, 96, [517]);

assert.equal(sampled.length, 96, 'Balanced-scale sampling stays within its visual budget');
assert.equal(sampled[0]?.index, 0, 'the first point is retained');
assert.equal(sampled.at(-1)?.index, 999, 'the last point is retained');
assert(sampled.some((entry) => entry.index === 517), 'the selected point is retained');
assert(sampled.every((entry, index) => index === 0 || entry.index > sampled[index - 1].index));
assert.strictEqual(source[517], sampled.find((entry) => entry.index === 517)?.value);
assert.equal(source.length, 1000, 'sampling does not mutate or truncate canonical data');

assert.deepEqual(
  sampleIndexedValues(source.slice(0, 3), 96),
  source.slice(0, 3).map((value, index) => ({ index, value })),
  'small paths retain every point',
);

console.log('interactive sampling contract ok');
