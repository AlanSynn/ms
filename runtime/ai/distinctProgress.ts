export const createDistinctIntegerProgress = (minimumStep = 1) => {
  let lastProgress: number | undefined;
  const step = Math.max(1, Math.round(minimumStep));

  return (value: number) => {
    const progress = Math.max(0, Math.min(100, Math.round(value)));
    if (
      lastProgress !== undefined
      && progress !== 100
      && Math.abs(progress - lastProgress) < step
    ) return undefined;
    lastProgress = progress;
    return progress;
  };
};
