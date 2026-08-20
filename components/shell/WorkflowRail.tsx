import motionSmithIconUrl from '../../src-tauri/icons/icon.png?url';
import type { AppStage } from '../../types';
import { STAGE_PANE_NAV_ITEMS, StagePaneNavIcon } from '../stages/stageLayout';
import { STAGES, stageNavLabel } from './workflowStages';

const APP_VERSION = __APP_VERSION__;

const MotionSmithLogoMark = ({ className = '' }: { className?: string }) => <img className={`motionsmith-logo-mark ${className}`.trim()} src={motionSmithIconUrl} alt="" aria-hidden="true" decoding="async" draggable={false}/>;

export const WorkflowRail = ({ stage, goStage, onHome }: { stage: AppStage; goStage: (stage: AppStage) => void; onHome: () => void }) => (
  <nav className="workflow-rail workspace-steps" data-testid="workspace-steps" aria-label="Workflow">
    <button type="button" className="workflow-rail-brand" data-testid="rail-home" onClick={onHome} aria-label="Home">
      <MotionSmithLogoMark className="workflow-rail-app-icon" />
    </button>
    {STAGES.map(item => {
      const navItem = STAGE_PANE_NAV_ITEMS.find(nav => nav.target === item.id);
      return <button key={item.id} type="button" aria-label={item.label} aria-current={stage === item.id ? 'step' : undefined} onClick={() => goStage(item.id)} className={stage === item.id ? 'active' : ''}>
        <span className="workflow-rail-mark" aria-hidden="true">{navItem && <StagePaneNavIcon icon={navItem.icon}/>}</span>
        <span className="workflow-rail-short">{stageNavLabel(item.id) ?? item.label}</span>
        <span className="workflow-rail-full">{item.label}</span>
      </button>;
    })}
    <span className="workflow-rail-version" aria-label={`MotionSmith version ${APP_VERSION}`}>v{APP_VERSION}</span>
  </nav>
);
