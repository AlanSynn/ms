import { useCallback, useEffect, useRef } from 'react';
import type { FeatureId } from '../utils/featureDestinations';
import type { FeatureRevealOptions } from '../utils/featureReveal';
export type { FeatureRevealOptions } from '../utils/featureReveal';

export const useFeatureReveal = (options: FeatureRevealOptions) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const generation = useRef(0);
  const cleanupRef = useRef<() => void>(() => {});
  const cancelReveal = useCallback(() => {
    generation.current++;
    cleanupRef.current();
    cleanupRef.current = () => {};
  }, []);
  const revealFeature = useCallback(async (id: FeatureId) => {
    cancelReveal();
    const token = generation.current, requested = optionsRef.current;
    try {
      const { beginFeatureReveal } = await import('../utils/featureReveal');
      if (generation.current !== token || optionsRef.current.project !== requested.project) return false;
      const result = beginFeatureReveal(optionsRef.current, id);
      cleanupRef.current = result.cancel;
      return result.accepted;
    } catch {
      if (generation.current === token) optionsRef.current.onStatus('Feature search unavailable. Try again.');
      return false;
    }
  }, [cancelReveal]);
  useEffect(() => cancelReveal, [cancelReveal]);
  return { revealFeature, cancelReveal };
};
