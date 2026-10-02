import assert from 'node:assert/strict';

// Measured runtime/architecture drift is at most 3.3e-11 degrees in the
// representative tangent metrics. 1e-8 also corresponds to 5e-9 mm for scene
// coordinates. This tolerance belongs to these golden checks, not fabrication.
export const FOUR_BAR_GOLDEN_EPSILON = 1e-8;

const continuousField = (path: string) =>
  /^\$\.generatedPath\[\d+\]\.[xy]$/.test(path)
  || /^\$\.fabricationMetadata\.pathFit\.(?:error|maxError|tangentError|maxTangentError)$/.test(path);

// Cover the full serialized mechanism, retaining object keys, array order and
// every discrete field. Undefined object fields were absent from old JSON hashes.
export const assertFourBarFitMechanism = (
  actual: unknown, expected: unknown, label: string,
) => {
  const visit = (value: unknown, reference: unknown, path: string): void => {
    const message = `${label}: ${path}`;
    if (typeof reference === 'number') {
      assert.equal(typeof value, 'number', message);
      assert(Number.isFinite(value) && Number.isFinite(reference), `${message} must be finite`);
      if (continuousField(path)) {
        assert(Math.abs((value as number) - reference) <= FOUR_BAR_GOLDEN_EPSILON,
          `${message}: ${value} versus ${reference}`);
      } else {
        assert.equal(value === 0 ? 0 : value, reference === 0 ? 0 : reference, message);
      }
      return;
    }
    if (Array.isArray(reference)) {
      assert(Array.isArray(value), message);
      assert.equal(value.length, reference.length, `${message} length`);
      reference.forEach((item, index) => visit(value[index], item, `${path}[${index}]`));
      return;
    }
    if (reference !== null && typeof reference === 'object') {
      assert(value !== null && typeof value === 'object' && !Array.isArray(value), message);
      const object = value as Record<string, unknown>;
      const baseline = reference as Record<string, unknown>;
      const keys = (record: Record<string, unknown>) => Object.keys(record)
        .filter((key) => record[key] !== undefined).sort();
      assert.deepEqual(keys(object), keys(baseline), `${message} keys`);
      keys(baseline).forEach((key) => visit(object[key], baseline[key], `${path}.${key}`));
      return;
    }
    assert.equal(value, reference, message);
  };
  visit(actual, expected, '$');
};
