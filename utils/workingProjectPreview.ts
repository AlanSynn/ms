import type { ProjectState } from '../types';
import {
  motionPathsInProjectOrder, playableMotionPaths, sharedMotionPlaybackDurationMs,
  motionTimelineMsForPhase, motionPreviewForPaths,
} from './motion';

export const visibleWorkingProjectPaths = (project: ProjectState) =>
  motionPathsInProjectOrder(project).filter(path => path.visible !== false && path.points.length > 1);

export const workingProjectMechanism = (project: ProjectState) => {
  const visible = project.mechanisms.filter(mechanism => mechanism.visible !== false);
  return visible.find(mechanism => mechanism.id === project.selectedMechanismId) ?? visible[0];
};

export const createWorkingPathPreview = (project: ProjectState) => {
  const paths = motionPathsInProjectOrder(project);
  const playable = playableMotionPaths(project, paths);
  const durationMs = sharedMotionPlaybackDurationMs(project, playable);
  return {
    paths: visibleWorkingProjectPaths(project), durationMs,
    sample: (phase: number, timelineMs = motionTimelineMsForPhase(phase, durationMs)) => playable.length
      ? motionPreviewForPaths(project, playable, timelineMs)
      : undefined,
  };
};
