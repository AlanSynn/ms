import React, { useState } from 'react';
import { FileJson } from 'lucide-react';
import type { AppStage, ProjectAction, ProjectState } from '../../../types';
import { pendingRecipeForMechanism } from '../../../utils/assemblyPlayback';
import { createFabricationPackage, fabricationBoardCoordinateCallout, fabricationPartDisplayLabel, readableFabricationStackSummary, validateForFabrication } from '../../../utils/fabrication';
import { referenceRecipeForType } from '../../../utils/mechanismReference';
import { downloadText } from '../../../utils/project';
import { EditorStageFrame, StageLeftSummary, canvasPane, inspectorPane, workflowPane } from '../stageLayout';

export const BlueprintExport = ({ project, dispatch, goStage }: {
    project: ProjectState;
    dispatch: (action: ProjectAction) => void;
    goStage: (stage: AppStage) => void;
}) => {
    const validation = validateForFabrication(project);
    const create = () => dispatch({ type: 'set_export', fabricationPackage: createFabricationPackage(project) });
    const pkg = project.lastExport;
    const exportMode = project.settings.physicalKit.exportMode;
    const defaultFormat = project.settings.physicalKit.defaultExportFormat;
    const cutSheetFileType = project.settings.physicalKit.cutSheetFileType;
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    const recipes = pkg?.recipes ?? activeMechanisms.map(mechanism => pendingRecipeForMechanism(project, mechanism));
    const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
    const selectedRecipe = recipes.find(recipe => recipe.mechanismId === selectedRecipeId) ?? recipes[0];
    const recipeTitle = (recipe: typeof recipes[number]) => referenceRecipeForType(recipe.type).title;
    const downloadJson = () => pkg && downloadText(`${pkg.id}.json`, JSON.stringify(pkg, null, 2));
    const downloadSvg = () => pkg && downloadText(`${pkg.id}.svg`, pkg.svg, 'image/svg+xml');
    const downloadCutSheetPdf = () => pkg && downloadText(`${pkg.id}-cut-sheet.pdf`, pkg.cutSheetPdf, 'application/pdf');
    const downloadCustomSvg = () => pkg && downloadText(`${pkg.id}-custom-parts.svg`, pkg.customPartsSvg, 'image/svg+xml');
    const downloadCustomPdf = () => pkg && downloadText(`${pkg.id}-custom-parts.pdf`, pkg.customPartsPdf, 'application/pdf');
    const downloadCustomStl = () => pkg && downloadText(`${pkg.id}-custom-parts.stl`, pkg.customPartsStl, 'model/stl');
    const downloadAssemblyPdf = () => pkg && downloadText(`${pkg.id}-assembly.pdf`, pkg.assemblyGuidePdf, 'application/pdf');
    return <EditorStageFrame
        stage="blueprint"
        className="blueprint-stage-frame"
        layout={{
            workflow: workflowPane(<div className="stage-pane-stack" data-testid="blueprint-control-panel">
            <StageLeftSummary project={project} title="Blueprint" stage="blueprint" goStage={goStage}>
                <h3>Cut sheet</h3>
                <div className="mt-4 space-y-2">{validation.issues.map((issue, index) => <div className={issue.severity === 'error' ? 'error' : 'warning'} key={`${issue.message}-${index}`}>
                    <div>{issue.message}</div>
                    <button className="mt-2 underline" onClick={() => goStage(issue.recoveryStage)}>{issue.recoveryAction}</button>
                </div>)}{!validation.errors.length && !validation.warnings.length && <div className="ok">Fabrication state ready.</div>}</div>
                <button className="btn-primary mt-5" aria-label="Generate package" disabled={!!validation.errors.length} onClick={create}><FileJson size={16}/> Generate</button>
                {pkg && <div className="mt-5 space-y-3">
                    <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                        <div className="font-bold text-slate-800">Default · {defaultFormat} · {exportMode}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {defaultFormat !== 'svg' && <button className="btn-primary" aria-label="Download JSON default" onClick={downloadJson}>JSON</button>}
                            {defaultFormat !== 'json' && <button className="btn-primary" aria-label="Download SVG default" onClick={downloadSvg}>SVG</button>}
                            <button className="btn-secondary" onClick={() => goStage('assembly')}>Assembly</button>
                        </div>
                    </div>
                    {exportMode !== 'prefab-board' && <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm" data-testid="custom-parts-export-lane">
                        <div className="font-bold text-slate-800">Custom parts</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button className="btn-secondary" onClick={downloadCustomSvg}>SVG</button>
                            <button className="btn-secondary" onClick={downloadCustomPdf}>PDF</button>
                            <button className="btn-secondary" data-testid="download-custom-stl" onClick={downloadCustomStl}>STL</button>
                        </div>
                    </div>}
                    {exportMode !== 'custom-parts' && <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm" data-testid="prefab-board-export-lane">
                        <div className="font-bold text-slate-800">Prefab kit</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button className="btn-secondary" aria-label="Assembly guide" onClick={() => goStage('assembly')}>Guide</button>
                            <button className="btn-secondary" onClick={downloadAssemblyPdf}>PDF</button>
                        </div>
                    </div>}
                    <div className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600">
                        <div className="font-bold text-slate-800">Cut sheet · {cutSheetFileType.toUpperCase()}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {cutSheetFileType === 'pdf'
                                ? <button className="btn-primary" aria-label="Download PDF cut sheet default" onClick={downloadCutSheetPdf}>PDF</button>
                                : <button className="btn-primary" aria-label="Download SVG cut sheet default" onClick={downloadSvg}>SVG</button>}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button className="btn-secondary" onClick={downloadJson}>JSON</button>
                        <button className="btn-secondary" onClick={downloadSvg}>SVG</button>
                        <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-assembly.html`, pkg.assemblyGuideHtml, 'text/html')}>HTML</button>
                        <button className="btn-secondary" onClick={() => downloadText(`${pkg.id}-metadata.json`, pkg.metadataJson)}>Metadata</button>
                        <button className="btn-secondary" onClick={downloadAssemblyPdf}>PDF</button>
                    </div>
                </div>}
                <div className="mt-5">
                    <h4 className="section-title">Recipes</h4>
                    <div className="mt-3 grid gap-2">
                        {recipes.map(recipe => <button key={recipe.mechanismId} type="button" className={`assembly-recipe-card text-left ${selectedRecipe?.mechanismId === recipe.mechanismId ? 'ring-2 ring-inset' : ''}`} onClick={() => setSelectedRecipeId(recipe.mechanismId)}>
                            <div className="font-bold text-slate-800">{recipe.mechanismId} · {recipeTitle(recipe)}</div>
                            <div className="text-sm text-slate-600">Anchor {fabricationBoardCoordinateCallout(recipe.boardCoordinate, recipe.board)}</div>
                        </button>)}
                    </div>
                </div>
            </StageLeftSummary>
        </div>),
            canvas: canvasPane(<div className="blueprint-document-preview canvas-workspace" data-testid="blueprint-canvas-preview">
            <div className="blueprint-document-title">Letter sheet · 2D cut blueprint</div>
            {pkg ? <img data-testid="blueprint-svg-preview" alt="Printable cut sheet blueprint" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pkg.svg)}`} /> : <div className="blueprint-empty-state">Generate first.</div>}
        </div>),
            inspector: inspectorPane(<section className="stage-pane-stack" data-testid="blueprint-detail-preview">
            <div>
                <div className="section-title">Detail</div>
                <h3>Cut sheet</h3>
            </div>
            {selectedRecipe ? <article className="assembly-recipe-card" data-testid={`blueprint-recipe-${selectedRecipe.mechanismId}`}>
                <div className="font-bold text-slate-800">{selectedRecipe.mechanismId} · {recipeTitle(selectedRecipe)}</div>
                <div className="mt-1 text-sm text-slate-600">Board anchor {fabricationBoardCoordinateCallout(selectedRecipe.boardCoordinate, selectedRecipe.board)}</div>
                <div className="mt-3 flex flex-wrap gap-2">{selectedRecipe.requiredParts.map(part => <span className="blueprint-pill" key={`${selectedRecipe.mechanismId}-${part.name}`}>{fabricationPartDisplayLabel(part.name)} × {part.quantity}</span>)}</div>
                <div className="mt-3 rounded-2xl bg-slate-100 p-3 text-sm font-bold text-slate-700" data-testid="blueprint-stack-summary">{readableFabricationStackSummary(selectedRecipe)}</div>
                {selectedRecipe.warnings.length ? <div className="warning mt-3">Warnings: {selectedRecipe.warnings.join('; ')}</div> : <div className="ok mt-3">No warnings</div>}
            </article> : <div className="warning">Generate first.</div>}
            {pkg && <div className="rounded-2xl bg-white p-3 text-sm text-slate-600 shadow-sm">Grid {project.settings.physicalKit.gridPitchMm}mm · holes {project.settings.physicalKit.holeDiameterMm}mm · {recipes.length} recipe{recipes.length === 1 ? '' : 's'}</div>}
        </section>)
        }}
    />;
};
