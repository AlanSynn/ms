import { FolderOpen, RotateCcw, Save, Sparkles } from 'lucide-react';
import type { AppStage, ProjectState } from '../../../types';
import type { AppCommandHandlerMap } from '../../../utils/appCommands';
import { DeferredThreePuppetPreview } from '../../DeferredThreePuppetPreview';
import { EditorStageFrame, canvasPane, inspectorPane, workflowPane } from '../stageLayout';

export const ProjectStage = ({ project, commandHandlers, goStage }: {
  project: ProjectState;
  commandHandlers: AppCommandHandlerMap;
  goStage: (stage: AppStage) => void;
}) => (
  <EditorStageFrame
    stage="project"
    className="project-stage-frame"
    layout={{
      workflow: workflowPane(
        <section className="stage-pane-stack" data-testid="project-lifecycle-panel">
          <div className="section-title">Project</div>
          <h3>{project.metadata.name}</h3>
          <div className="grid gap-2">
            <button className="btn-primary justify-start" onClick={commandHandlers['project.save']}><Save size={16} /> Save Project</button>
            <button className="btn-secondary justify-start" onClick={commandHandlers['project.open']}><FolderOpen size={16} /> Open Project</button>
            <button className="btn-secondary justify-start" onClick={commandHandlers['project.new']}><Sparkles size={16} /> New Project</button>
            <button className="btn-secondary justify-start" onClick={commandHandlers['project.recoverAutosave']}><RotateCcw size={16} /> Recover Autosave</button>
          </div>
          <button className="btn-secondary justify-start" onClick={() => goStage('blueprint')}>Open Blueprint</button>
        </section>,
      ),
      canvas: canvasPane(
        <div className="canvas-workspace" data-testid="project-canvas-preview">
          <DeferredThreePuppetPreview
            project={project}
            skeleton={project.skeleton}
            mechanisms={project.mechanisms}
            paths={Object.values(project.paths)}
            selectedPathId={project.selectedPathId}
            testId="project-three-puppet"
            cameraPresets={["front", "iso"]}
            initialCameraPreset="front"
          />
        </div>,
      ),
      inspector: inspectorPane(
        <section className="stage-pane-stack" data-testid="project-summary">
          <div className="section-title">Project state</div>
          <h3>{project.metadata.name}</h3>
          <div className="assembly-recipe-card">
            <strong>{project.partOrder.length} parts</strong>
            <div>{(project.pathOrder ?? Object.keys(project.paths)).length} motion paths</div>
            <div>{project.mechanisms.length} mechanisms</div>
          </div>
          <div className="ok">Browser autosave on</div>
          <div className="text-xs font-bold text-slate-500">Portable file: .motionsmith</div>
        </section>,
      ),
    }}
  />
);
