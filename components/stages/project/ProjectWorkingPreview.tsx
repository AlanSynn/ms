import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { CanvasViewport, ProjectState } from '../../../types';
import type { PlaybackClock } from '../../../runtime/playback/externalPlaybackClock';
import type { WorkingPreviewCameraProps } from '../mechanism/useWorkingPreviewCamera';
import type { WorkingPreviewFit } from '../../../utils/workingPreviewCamera';
import { createWorkingPathPreview, workingProjectMechanism } from '../../../utils/workingProjectPreview';
import { DeferredThreePuppetPreview } from '../../DeferredThreePuppetPreview';
import { DesignFoundryPreview } from '../mechanism/DesignFoundryPreview';

export type ProjectWorkingPreviewProps = WorkingPreviewCameraProps & {
  project: ProjectState;
  angle: number;
  isPlaying: boolean;
  playbackClock: PlaybackClock;
  viewport: CanvasViewport;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
};

const overviewLayers = { skeleton: false, mechanisms: false };

const ProjectPathPreview = ({ project, angle, isPlaying, playbackClock, viewport, setViewport }: ProjectWorkingPreviewProps) => {
  const preview = useMemo(() => createWorkingPathPreview(project), [project]);
  const sample = useMemo(() => (phase: number) => preview.sample(phase, playbackClock.getTimelineMs() || undefined), [playbackClock, preview]);
  const pose = useMemo(() => sample(angle), [angle, sample]);
  const [fitRequest, setFitRequest] = useState<WorkingPreviewFit | undefined>(() =>
    viewport.zoom === 1 && viewport.offset.x === 0 && viewport.offset.y === 0
      ? { id: 0, scope: 'content' } : undefined);
  useEffect(() => playbackClock.setTimelineDuration(preview.durationMs), [playbackClock, preview.durationMs]);
  const hasContent = project.partOrder.some(id => project.parts[id]?.visible) ||
    project.sceneObjectOrder.some(id => project.sceneObjects[id]?.visible) || preview.paths.length > 0;
  if (!hasContent) return <div className="blueprint-empty-state" data-testid="project-working-empty">No visible parts</div>;
  return <section className="canvas-workspace" style={{ height: '100%' }} data-testid="project-working-preview"
    data-renderer-source="ThreePuppetPreview" data-working-motion-source={pose ? 'authored-paths' : 'character'}>
    <DeferredThreePuppetPreview
      project={project}
      skeleton={pose?.skeleton ?? project.skeleton}
      animatedParts={pose?.parts}
      animatedSceneObjects={pose?.sceneObjects}
      mechanisms={[]}
      paths={preview.paths}
      selectedPathId={project.selectedPathId}
      angle={angle}
      playback={{ clock: playbackClock, sample: phase => isPlaying ? sample(phase) : undefined }}
      viewport={viewport}
      setViewport={setViewport}
      fitRequest={fitRequest}
      cameraPresets={['front', 'iso']}
      initialCameraPreset="front"
      initialLayers={overviewLayers}
      showPathHandles={false}
      showLayerControls={false}
      testId="project-three-puppet"
    />
    <div className="canvas-zoom-toolbar" aria-label="Project framing">
      <button type="button" onClick={() => setFitRequest(value => ({ id: (value?.id ?? 0) + 1, scope: 'content' }))}>Fit</button>
      <button type="button" onClick={() => setFitRequest(value => ({ id: (value?.id ?? 0) + 1, scope: 'scene' }))}>Full scene</button>
    </div>
  </section>;
};

// The stage lazy-loads this boundary. Exactly one existing renderer owns the view.
export const ProjectWorkingPreview = (props: ProjectWorkingPreviewProps) => {
  const mechanism = workingProjectMechanism(props.project);
  return mechanism
    ? <DesignFoundryPreview {...props} mechanism={mechanism} showTrace presentation="project" />
    : <ProjectPathPreview {...props} />;
};
