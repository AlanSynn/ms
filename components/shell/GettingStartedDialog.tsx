import React, { useEffect, useRef, useState } from 'react';
import { BrainCircuit, FileJson, Sparkles, Upload } from 'lucide-react';

export type StarterImageTemplate = { id: string; label: string; fileName: string; url: string; thumbUrl: string };
export type GuidedLessonTile = {
    id: string;
    label: string;
    outcome: string;
    changeCue: string;
    buildCue: string;
    actionLabel: string;
    sensemaking?: {
        directTranslation?: string;
        tryThis?: string;
        expectedAnswer?: string;
        evidenceCue?: string;
        clipSlot?: 'generated-loop' | 'local-asset' | 'optional-url';
    };
};

export const GettingStartedDialog = ({ starterTemplates, guidedLessons, hideForSession, onLesson, onSample, onStarterImage, onPackage, onProcess, onImport, onHideForSessionChange, onClose }: {
    starterTemplates: StarterImageTemplate[];
    guidedLessons: readonly GuidedLessonTile[];
    hideForSession: boolean;
    onLesson: (lessonId: string) => void;
    onSample: () => void;
    onStarterImage: (template: StarterImageTemplate) => void;
    onPackage: (files: FileList | File[]) => void;
    onProcess: (file: File) => void;
    onImport: (file: File) => void;
    onHideForSessionChange: (hidden: boolean) => void;
    onClose: () => void;
}) => {
    const dialogRef = useRef<HTMLElement>(null);
    const packageInputRef = useRef<HTMLInputElement>(null);
    const onnxInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const [showGuided, setShowGuided] = useState(false);
    useEffect(() => { dialogRef.current?.focus(); }, []);
    const trapDialogFocus = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key !== 'Tab') return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((element): element is HTMLElement => element instanceof HTMLElement && element.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables.at(-1)!;
        const active = document.activeElement;
        if (!dialog.contains(active)) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && (active === first || active === dialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return <div className="modal-backdrop starter-backdrop" role="presentation">
        <section ref={dialogRef} className="modal-sheet getting-started-dialog animate-rise" role="dialog" aria-modal="true" aria-labelledby="getting-started-title" data-testid="getting-started-dialog" tabIndex={-1} onKeyDown={trapDialogFocus}>
            <div className="getting-started-head">
                <div>
                    <div className="section-title">Getting started</div>
                    <h2 id="getting-started-title">{showGuided ? 'Pick a project.' : 'Start.'}</h2>
                </div>
                <button type="button" className="btn-secondary" onClick={showGuided ? () => setShowGuided(false) : onClose}>{showGuided ? 'Starters' : 'Close'}</button>
            </div>
            {showGuided ? <div className="guided-project-library" data-testid="guided-project-library">
                {guidedLessons.map(lesson => <button key={lesson.id} type="button" className="template-tile primary guided-project-card" data-testid={`guided-project-card-${lesson.id}`} aria-label={`${lesson.actionLabel}: ${lesson.outcome}`} data-change-cue={lesson.changeCue} data-build-cue={lesson.buildCue} data-direct-translation={lesson.sensemaking?.directTranslation ?? ''} data-evidence-cue={lesson.sensemaking?.evidenceCue ?? ''} data-expected-answer={lesson.sensemaking?.expectedAnswer ?? ''} data-clip-slot={lesson.sensemaking?.clipSlot ?? ''} onClick={() => onLesson(lesson.id)}>
                    <span className="blueprint-pill">{lesson.buildCue}</span>
                    <strong>{lesson.outcome}</strong>
                    <span className="guided-card-cues" aria-hidden="true">
                        <span><em>Change</em> {lesson.changeCue}</span>
                        <span><em>Build</em> {lesson.buildCue}</span>
                    </span>
                    <b><Sparkles size={16}/> Open</b>
                </button>)}
            </div> : <>
                <div className="template-gallery" data-testid="getting-started-gallery">
                    <button type="button" className="template-tile primary" data-testid="getting-started-card-guided" aria-label="Open Guide" onClick={() => setShowGuided(true)}>
                        <span className="template-icon-slot"><Sparkles size={18}/></span>
                        <strong>Guide</strong>
                        <b><Sparkles size={16}/> Open</b>
                    </button>
                    <button type="button" className="template-tile primary" data-testid="getting-started-card-humanoid" aria-label="Open starter rig" onClick={onSample}>
                        <span className="template-icon-slot"><Sparkles size={18}/></span>
                        <strong>Starter rig</strong>
                        <b><Sparkles size={16}/> Start</b>
                    </button>
                    {starterTemplates.map(template => (
                        <button key={template.id} type="button" className="template-tile starter cursor-pointer" data-testid={`getting-started-card-${template.id}`} aria-label={`Start ${template.label} starter`} onClick={() => onStarterImage(template)}>
                            <span className="template-icon-slot"><img className="starter-thumb" src={template.thumbUrl} alt="" /></span>
                            <strong>{template.label}</strong>
                            <b><Sparkles size={16}/> Start</b>
                        </button>
                    ))}
                    <button type="button" className="template-tile cursor-pointer" data-testid="getting-started-card-image" aria-label="Choose image" onClick={() => onnxInputRef.current?.click()}>
                        <span className="template-icon-slot"><BrainCircuit size={18}/></span>
                        <strong>Image</strong>
                        <b><BrainCircuit size={16}/> Choose</b>
                    </button>
                    <input ref={onnxInputRef} data-testid="getting-started-onnx-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (file) onProcess(file);
                    }}/>
                    <button type="button" className="template-tile cursor-pointer" data-testid="getting-started-card-package" aria-label="Load character file" onClick={() => packageInputRef.current?.click()}>
                        <span className="template-icon-slot"><FileJson size={18}/></span>
                        <strong>Character file</strong>
                        <b><FileJson size={16}/> Load</b>
                    </button>
                    <input ref={packageInputRef} data-testid="getting-started-package-input" hidden type="file" multiple accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => {
                        const files = e.currentTarget.files ? Array.from(e.currentTarget.files) as File[] : [];
                        e.currentTarget.value = '';
                        if (files.length) onPackage(files);
                    }}/>
                </div>
                <div className="getting-started-foot">
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-600" data-testid="getting-started-hide-session">
                        <input type="checkbox" checked={hideForSession} onChange={event => onHideForSessionChange(event.currentTarget.checked)}/>
                        Don&apos;t show again this session
                    </label>
                    <button type="button" className="btn-secondary cursor-pointer" onClick={() => importInputRef.current?.click()}><Upload size={16}/> Open full project</button><input ref={importInputRef} data-testid="getting-started-import-input" hidden type="file" accept="application/json,.json" onChange={e => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) onImport(file);
                    }}/>
                </div>
            </>}
        </section>
    </div>;
};
