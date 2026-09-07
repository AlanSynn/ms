import { lazy, Suspense, type Dispatch, type SetStateAction } from 'react';
import { FolderOpen, Save, Sparkles } from 'lucide-react';
import type { AppStage, CanvasViewport, ProjectState } from '../../../types';
import type { AppCommandHandlerMap } from '../../../utils/appCommands';
import type { FoundryCamera } from '../../../utils/foundryCamera';
import type { PlaybackClock } from '../../../runtime/playback/externalPlaybackClock';
import type { BrowserRecoveryCandidate, ProjectBackupStatus } from '../../../runtime/persistence/projectDecisionBoundary';
import { BrowserRecoveryAction } from '../../shell/BrowserRecoveryAction';
import { EditorStageFrame, canvasPane, inspectorPane, workflowPane } from '../stageLayout';

const ProjectWorkingPreview = lazy(async () => ({
  default: (await import('./ProjectWorkingPreview')).ProjectWorkingPreview,
}));
const BACKUP_LABELS = { waiting: 'Waiting', off: 'Off', saving: 'Writing', saved: 'Written', failed: 'Failed' } as const;

export const ProjectStage = ({ project, commandHandlers, goStage, angle, isPlaying,
  playbackClock, viewport, setViewport, camera, onCameraChange, backup = { state: 'waiting' }, recoveryCandidate,
}: {
  project: ProjectState;
  commandHandlers: AppCommandHandlerMap;
  goStage: (stage: AppStage) => void;
  angle: number;
  isPlaying: boolean;
  playbackClock: PlaybackClock;
  viewport: CanvasViewport;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  camera?: FoundryCamera;
  onCameraChange?: (camera: FoundryCamera) => void;
  backup?: ProjectBackupStatus;
  recoveryCandidate?: BrowserRecoveryCandidate;
}) => {
  const pathCount = Object.keys(project.paths).length;
  const hasWork = project.partOrder.length > 0 || project.sceneObjectOrder.length > 0
    || pathCount > 0 || project.mechanisms.length > 0;
  return <EditorStageFrame
    stage="project"
    className="project-stage-frame"
    layout={{
      workflow: workflowPane(
        <section className="stage-pane-stack" data-testid="project-lifecycle-panel">
          <div className="section-title">Project</div>
          <h3 data-capture-mask>{hasWork ? project.metadata.name : 'Open your project'}</h3>
          <div className="grid gap-2">
            {!hasWork && <button className="btn-primary justify-start" onClick={commandHandlers['project.open']}><FolderOpen size={16} /> Open Project</button>}
            <button className={`${hasWork ? 'btn-primary' : 'btn-secondary'} justify-start`} onClick={commandHandlers['project.save']}><Save size={16} /> Save Project</button>
            {hasWork && <button className="btn-secondary justify-start" onClick={commandHandlers['project.open']}><FolderOpen size={16} /> Open Project</button>}
            <button className="btn-secondary justify-start" onClick={commandHandlers['project.new']}><Sparkles size={16} /> New Project</button>
          </div>
          {hasWork && <div className="grid gap-2">
            <button className="btn-secondary justify-start" onClick={() => goStage('path')}>Edit paths</button>
            <button className="btn-secondary justify-start" onClick={() => goStage('blueprint')}>Build / Print</button>
          </div>}
          {recoveryCandidate && <BrowserRecoveryAction candidate={recoveryCandidate} onRecover={commandHandlers['project.recoverAutosave']} />}
        </section>,
      ),
      canvas: canvasPane(
        <div className="canvas-workspace" data-testid="project-canvas-preview">
          {hasWork ? <Suspense fallback={<div className="project-preview-empty" role="status">Opening view…</div>}>
            <ProjectWorkingPreview project={project} angle={angle} isPlaying={isPlaying}
              playbackClock={playbackClock} viewport={viewport} setViewport={setViewport}
              camera={camera} onCameraChange={onCameraChange} />
          </Suspense> : <div className="project-preview-empty" data-testid="project-empty-state">
            <FolderOpen size={36} aria-hidden="true" /><span>No project open</span>
            <button className="btn-secondary" onClick={commandHandlers['project.open']}>Choose file</button>
          </div>}
        </div>,
      ),
      inspector: inspectorPane(
        <section className="stage-pane-stack" data-testid="project-summary">
          <div className="section-title">Project</div>
          {hasWork && <>
            <h3 data-capture-mask>{project.metadata.name}</h3>
            <div className="assembly-recipe-card">
              <strong>{project.partOrder.length} parts</strong>
              <div>{pathCount} paths</div>
              <div>{project.mechanisms.length} mechanisms</div>
            </div>
          </>}
          <div className={backup.state === 'failed' ? 'warn' : 'status-chip'}
            data-testid="project-backup-status" data-backup-state={backup.state}>
            Browser backup: {BACKUP_LABELS[backup.state]}
          </div>
          {backup.state === 'failed' && <div className="text-xs">Use Save Project</div>}
          <div className="text-xs font-bold text-slate-500">Project file: .motionsmith</div>
        </section>,
      ),
    }}
  />;
};
