import type { Point } from '../../types';
import {
  createCadencedGestureDraft,
  type CadencedGestureDraftOptions,
  type GestureDraftScheduler,
} from '../interactions/cadencedGestureDraft';

export type PathGestureDraftSnapshot = {
  pathId: string;
  points: Point[];
  closed: boolean;
  selectedPointIndex?: number | null;
};

export type PathGestureDraftScheduler = GestureDraftScheduler;

export const createPathGestureDraft = (
  options: CadencedGestureDraftOptions = {},
) => createCadencedGestureDraft<PathGestureDraftSnapshot>(options);

export type PathGestureDraft = ReturnType<typeof createPathGestureDraft>;
