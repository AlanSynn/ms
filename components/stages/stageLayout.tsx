import React from 'react';
import { Boxes, Download, FileJson, PenLine, Settings, UserRound, Wrench } from 'lucide-react';
import type { AppStage, ProjectState } from '../../types';

export type StageIconName = 'character' | 'path' | 'foundry' | 'design' | 'blueprint' | 'assembly' | 'options';

export const STAGE_PANE_NAV_ITEMS: Array<{ ariaLabel: string; label: string; target: AppStage; activeStages: AppStage[]; icon: StageIconName }> = [
    { ariaLabel: 'Character', label: 'Character', target: 'character', activeStages: ['character'], icon: 'character' },
    { ariaLabel: 'Rail motion path', label: 'Path', target: 'path', activeStages: ['path'], icon: 'path' },
    { ariaLabel: 'Mechanism Foundry', label: 'Foundry', target: 'foundry', activeStages: ['foundry'], icon: 'foundry' },
    { ariaLabel: 'Rail mechanism parameters', label: 'Design', target: 'design', activeStages: ['design'], icon: 'design' },
    { ariaLabel: 'Rail export package', label: 'Blueprint', target: 'blueprint', activeStages: ['blueprint'], icon: 'blueprint' },
    { ariaLabel: 'Rail assembly guide', label: 'Assembly', target: 'assembly', activeStages: ['assembly'], icon: 'assembly' },
    { ariaLabel: 'Options', label: 'Options', target: 'options', activeStages: ['options'], icon: 'options' }
];

export const StagePaneNavIcon = ({ icon }: { icon: typeof STAGE_PANE_NAV_ITEMS[number]['icon'] }) => {
    if (icon === 'character') return <UserRound size={16}/>;
    if (icon === 'path') return <PenLine size={16}/>;
    if (icon === 'foundry') return <Boxes size={16}/>;
    if (icon === 'design') return <Wrench size={16}/>;
    if (icon === 'blueprint') return <Download size={16}/>;
    if (icon === 'assembly') return <FileJson size={16}/>;
    return <Settings size={16}/>;
};

const EDITOR_PANE_CONTRACT = {
    left: { testId: 'stage-left-pane', ariaLabel: 'Workflow and primary actions' },
    center: { testId: 'stage-canvas-pane', ariaLabel: 'Shared canvas' },
    right: { testId: 'stage-right-inspector', ariaLabel: 'Selected item inspector' }
} as const;

const classroomChecklistFor = (project: ProjectState) => {
    const hasCharacter = project.partOrder.length > 0;
    const hasPath = Object.values(project.paths).some(path => path.enabled && path.points.length >= 3);
    const eligibleMechanisms = project.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false && mechanism.targetPartId && mechanism.targetPathId);
    const hasMechanism = eligibleMechanisms.length > 0;
    const hasTestableFit = eligibleMechanisms.some(mechanism => (mechanism.generatedPath?.length ?? 0) >= 3);
    const hasBlueprint = Boolean(project.lastExport);
    const hasAssembly = Boolean(project.lastExport?.recipes.length);
    return [
        ['Character', hasCharacter],
        ['Path', hasPath],
        ['Mechanism', hasMechanism],
        ['Test', hasTestableFit],
        ['Blueprint', hasBlueprint],
        ['Assembly', hasAssembly]
    ] as const;
};

type PaneSlot<Kind extends 'workflow' | 'canvas' | 'inspector'> = Readonly<{
    kind: Kind;
    content: React.ReactNode;
}>;
export type StageLayoutSpec = Readonly<{
    workflow: PaneSlot<'workflow'>;
    canvas: PaneSlot<'canvas'>;
    inspector: PaneSlot<'inspector'>;
}>;
export const workflowPane = (content: React.ReactNode): PaneSlot<'workflow'> => ({ kind: 'workflow', content });
export const canvasPane = (content: React.ReactNode): PaneSlot<'canvas'> => ({ kind: 'canvas', content });
export const inspectorPane = (content: React.ReactNode): PaneSlot<'inspector'> => ({ kind: 'inspector', content });

export const EditorStageFrame = ({ stage, layout, className = '' }: { stage: AppStage; layout: StageLayoutSpec; className?: string }) => (
    <div className={`editor-stage-frame ${className}`.trim()} data-stage={stage}>
        <aside className="stage-left-pane workspace p-5" data-pane-kind={layout.workflow.kind} data-testid={EDITOR_PANE_CONTRACT.left.testId} aria-label={EDITOR_PANE_CONTRACT.left.ariaLabel}>
            <div className="stage-left-pane-content" data-testid="editor-sidebar">{layout.workflow.content}</div>
        </aside>
        <section className="stage-canvas-pane" data-pane-kind={layout.canvas.kind} data-testid={EDITOR_PANE_CONTRACT.center.testId} aria-label={EDITOR_PANE_CONTRACT.center.ariaLabel}>{layout.canvas.content}</section>
        <aside className="stage-right-inspector workspace p-5" data-pane-kind={layout.inspector.kind} data-testid={EDITOR_PANE_CONTRACT.right.testId} aria-label={EDITOR_PANE_CONTRACT.right.ariaLabel}>{layout.inspector.content}</aside>
    </div>
);

export const StageLeftSummary = ({ project, title, stage, goStage, children }: {
    project: ProjectState;
    title: string;
    stage: AppStage;
    goStage?: (stage: AppStage) => void;
    children: React.ReactNode;
}) => {
    const linkClass = (targets: AppStage[]) => `workspace-side-link ${targets.includes(stage) ? 'active' : ''}`;
    return <>
        <div hidden className="stage-project-card" data-testid="stage-project-card" aria-label={`${project.metadata.name}: ${project.partOrder.length} parts, ${Object.keys(project.paths).length} paths, ${project.mechanisms.length} mechanisms, ${project.settings.physicalKit.gridPitchMm} millimeter grid`}>
            <span data-testid="project-compact-stats">{project.partOrder.length} parts · {Object.keys(project.paths).length} paths · {project.mechanisms.length} mechanisms · {project.settings.physicalKit.gridPitchMm}mm</span>
        </div>
        {goStage && <nav className="stage-nav-compact">
            <div className="section-title">Flow</div>
            {STAGE_PANE_NAV_ITEMS.map(item => <button key={item.ariaLabel} aria-label={item.ariaLabel} aria-current={item.activeStages.includes(stage) ? 'step' : undefined} className={linkClass(item.activeStages)} onClick={() => goStage(item.target)}><StagePaneNavIcon icon={item.icon}/> {item.label}</button>)}
        </nav>}
        {project.metadata.classroomLessonId && <div className="classroom-checklist" data-testid="classroom-checklist" aria-label="Classroom lesson checklist">
            {classroomChecklistFor(project).map(([label, done]) => <span key={label} className={done ? 'done' : ''} aria-checked={done} role="checkbox">{label}</span>)}
        </div>}
        <div className="stage-workflow-block">
            <div className="section-title">{title}</div>
            {children}
        </div>
    </>;
};
