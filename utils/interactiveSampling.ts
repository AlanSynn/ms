export type IndexedSample<T> = {
  index: number;
  value: T;
};

/**
 * Selects a stable, evenly distributed interactive view of a larger sequence.
 * The source is never mutated or truncated, and explicitly required indices
 * remain addressable even when the visual representation is reduced.
 */
export const sampleIndexedValues = <T>(
  values: readonly T[],
  maximum: number,
  requiredIndices: readonly number[] = [],
): IndexedSample<T>[] => {
  const limit = Math.max(1, Math.floor(maximum));
  if (values.length <= limit) {
    return values.map((value, index) => ({ index, value }));
  }

  const required = new Set(
    [0, values.length - 1, ...requiredIndices]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < values.length)
      .slice(0, limit),
  );
  const selected = new Set(required);

  while (selected.size < limit) {
    const ordered = [...selected].sort((a, b) => a - b);
    let largestGap = 0;
    let midpoint = -1;
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index] - ordered[index - 1];
      if (gap > largestGap) {
        largestGap = gap;
        midpoint = Math.floor((ordered[index] + ordered[index - 1]) / 2);
      }
    }
    if (midpoint < 0 || selected.has(midpoint)) break;
    selected.add(midpoint);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => ({ index, value: values[index] }));
};
