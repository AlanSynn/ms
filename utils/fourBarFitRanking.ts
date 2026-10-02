// Ranking resolves numerical ties only. Keep the original measurements for
// diagnostics and every physical acceptance check. The 1e-9 score resolution
// is far below the fitter's 0.01 pivot snap and 12+ scene-unit path tolerances.
export const FOUR_BAR_FIT_SCORE_RESOLUTION = 1e-9;

export const compareFourBarFitScores = (a: number, b: number): number => {
  const rank = (score: number) => {
    if (!Number.isFinite(score)) return Number.POSITIVE_INFINITY;
    // Outside the safe integer range, floating point spacing already exceeds
    // the bin width. Retain the finite score rather than overflowing to infinity.
    return Math.abs(score) > Number.MAX_SAFE_INTEGER * FOUR_BAR_FIT_SCORE_RESOLUTION
      ? score
      : Math.round(score / FOUR_BAR_FIT_SCORE_RESOLUTION) * FOUR_BAR_FIT_SCORE_RESOLUTION;
  };
  const left = rank(a);
  const right = rank(b);
  return left === right ? 0 : left < right ? -1 : 1;
};

export type FourBarFitRank = {
  score: number;
  geometryOrder: readonly number[];
};

// Integer bins give a transitive order; pairwise epsilon comparisons do not.
// As with any quantization, scores on opposite sides of a bin boundary differ.
export const compareFourBarFitRanks = (a: FourBarFitRank, b: FourBarFitRank) => {
  const scoreOrder = compareFourBarFitScores(a.score, b.score);
  if (scoreOrder) return scoreOrder;
  for (let index = 0; index < Math.min(a.geometryOrder.length, b.geometryOrder.length); index += 1) {
    const left = Number.isFinite(a.geometryOrder[index]) ? a.geometryOrder[index] : Number.POSITIVE_INFINITY;
    const right = Number.isFinite(b.geometryOrder[index]) ? b.geometryOrder[index] : Number.POSITIVE_INFINITY;
    if (left !== right) return left < right ? -1 : 1;
  }
  return a.geometryOrder.length - b.geometryOrder.length;
};

export const retainFourBarFitCandidate = <T extends FourBarFitRank>(
  pool: T[], candidate: T, limit: number,
) => {
  if (!Number.isFinite(candidate.score) || !candidate.geometryOrder.every(Number.isFinite)) return;
  if (pool.length >= limit && compareFourBarFitRanks(candidate, pool.at(-1)!) >= 0) return;
  pool.push(candidate);
  pool.sort(compareFourBarFitRanks);
  if (pool.length > limit) pool.pop();
};
