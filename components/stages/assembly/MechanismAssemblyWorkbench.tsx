import type { FabricationRecipe, PhysicalKitSettings } from '../../../types';
import type { AssemblyLane, AssemblyPlaybackStep } from '../../../utils/assemblyPlayback';
import { fabricationBoardColumnLabel, fabricationBoardCoordinateCallout, fabricationBoardRowLabel, fabricationPartDisplayLabel } from '../../../utils/fabrication';
import { MECHANISM_TEMPLATE_LIBRARY } from '../../../utils/mechanismTemplates';
import { isBoardFixedCoordRole } from '../../../utils/mechanismReference';
import {
    ASSEMBLY_QUIET_OPACITY,
    ASSEMBLY_REFERENCE_OPACITY,
    assemblyCoordToSvg,
    smoothAssemblyProgress
} from './assemblyGeometry';


export const AssemblyWorkbench = ({ recipe, lane, step, kit, progress = 0 }: { recipe: FabricationRecipe; lane: AssemblyLane; step: AssemblyPlaybackStep; kit: PhysicalKitSettings; progress?: number }) => {
    const eased = smoothAssemblyProgress(progress);
    const recipeTitle = MECHANISM_TEMPLATE_LIBRARY[recipe.type].label;
    const sensemaking = MECHANISM_TEMPLATE_LIBRARY[recipe.type].classroomSensemaking;
    const boardActive = lane === 'kit' && ['mount-to-board', 'connect-character', 'test-motion'].includes(step.phase);
    const stack = step.stack.length ? step.stack : recipe.assemblySteps.flatMap(item => item.stack ?? []).slice(0, 5);
    const coordEntries = step.coords.map((coord, index) => ({
        coord,
        role: step.coordRoles[index] ?? 'moving_reference',
        point: assemblyCoordToSvg(coord)
    })).filter((entry): entry is { coord: string; role: string; point: { x: number; y: number } } => Boolean(entry.point));
    const boardCoordEntries = coordEntries.filter(entry => isBoardFixedCoordRole(entry.role));
    const floatingCoordEntries = coordEntries.filter(entry => !isBoardFixedCoordRole(entry.role));
    const activeCoords = boardCoordEntries.map(entry => entry.point);
    const currentLayer = Math.max(0, Math.min(stack.length - 1, step.phase === 'assemble-module' ? step.index - 2 : stack.length - 1));
    const activeLayerLabel = stack[currentLayer]?.label ? fabricationPartDisplayLabel(stack[currentLayer].label) : `${recipeTitle} module`;
    const primaryBoardPoint = activeCoords[0] ?? assemblyCoordToSvg(recipe.boardCoordinate) ?? { x: 620, y: 260 };
    const home = { x: 76, y: 176 };
    const mounted = { x: primaryBoardPoint.x - 92, y: primaryBoardPoint.y - 102 };
    const mountedProgress = step.phase === 'mount-to-board' ? eased : ['connect-character', 'test-motion'].includes(step.phase) ? 1 : 0;
    const moduleTranslate = {
        x: home.x + (mounted.x - home.x) * mountedProgress,
        y: home.y + (mounted.y - home.y) * mountedProgress
    };
    const motionAngle = eased * Math.PI * 2;
    const motionDot = {
        x: primaryBoardPoint.x + 70 + Math.cos(motionAngle) * 54,
        y: primaryBoardPoint.y + 34 + Math.sin(motionAngle) * 38
    };
    return <section
        className="assembly-stepper-workbench"
        data-testid="assembly-stepper-workbench"
        data-step-phase={step.phase}
        data-step-motion={step.motion}
        data-step-progress={Math.round(progress * 100)}
        data-active-coords={coordEntries.map(entry => `${entry.coord}:${entry.role}`).join(',')}
        data-active-board-coords={boardCoordEntries.map(entry => entry.coord).join(',')}
        data-floating-reference-coords={floatingCoordEntries.map(entry => entry.coord).join(',')}
        data-board-mode={boardActive ? 'active' : 'reference'}
        data-board-opacity={boardActive ? '1' : String(ASSEMBLY_REFERENCE_OPACITY)}
        data-active-layer-label={activeLayerLabel}
        data-visual-level="guided-animation"
        data-interaction-mode="visual-first"
        aria-label="Interactive assembly workbench"
    >
        <div className="assembly-workbench-head">
            <div>
                <div className="section-title">Assembly</div>
                <h3>{step.label}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
                <span className="blueprint-pill" data-testid="assembly-workbench-sensemaking" data-sensemaking-check={sensemaking.studentCheck} data-sensemaking-answer={sensemaking.expectedAnswer} data-sensemaking-evidence={sensemaking.evidenceCue} data-sensemaking-clip={sensemaking.clipSlot}>{sensemaking.directTranslation}</span>
                <span className="blueprint-pill">{lane === 'kit' ? `${kit.boardCells}×${kit.boardCells} board` : 'custom parts'}</span>
            </div>
        </div>
        <svg className="assembly-workbench-svg" viewBox="0 0 900 560" role="img" aria-label={`${recipeTitle} assembly step ${step.index}`}>
            <title>{`${step.label} · ${lane === 'kit' ? 'board assembly' : 'custom parts assembly'}`}</title>
            <defs>
                <linearGradient id="assembly-layer-fill" x1="0" x2="1"><stop offset="0" stopColor="#dbeafe"/><stop offset="1" stopColor="#a78bfa"/></linearGradient>
                <linearGradient id="assembly-part-depth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f8fafc"/><stop offset="1" stopColor="#dbeafe"/></linearGradient>
                <marker id="assembly-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#8b5cf6"/></marker>
            </defs>
            <g data-testid="assembly-visual-progress" className="assembly-visual-progress" aria-hidden="true">
                {['parts-tray', 'assemble-module', 'mount-to-board', 'connect-character', 'test-motion'].map((phase, index) => {
                    const active = phase === step.phase || (phase === 'assemble-module' && step.phase === 'export');
                    return <g key={phase} transform={`translate(${56 + index * 52} 48)`} opacity={active ? 1 : 0.5}>
                        <circle r="10" className={active ? 'assembly-progress-dot active' : 'assembly-progress-dot'}/>
                        {index < 4 && <line x1="14" y1="0" x2="38" y2="0" className="assembly-progress-line"/>}
                    </g>;
                })}
            </g>
            <rect x="28" y="78" width="388" height="370" rx="28" fill="#fff" stroke="#dbe3f1"/>
            <g data-testid="assembly-parts-tray" opacity={step.motion === 'parts-tray' || step.phase === 'export' ? 1 : ASSEMBLY_QUIET_OPACITY}>
                <rect x="446" y="124" width="346" height="252" rx="24" fill="#ffffff" stroke="#dbe3f1"/>
                <title>{lane === 'kit' ? 'Parts tray' : 'Cut or print parts'}</title>
                {recipe.requiredParts.slice(0, 8).map((part, index) => {
                    const x = 474 + (index % 2) * 154;
                    const y = 190 + Math.floor(index / 2) * 38;
                    return <g key={`${part.name}-${index}`} className="assembly-tray-part">
                        <rect x={x} y={y} width="126" height="24" rx="12" fill={index % 2 ? '#ede9fe' : '#e0f2fe'} stroke="#cbd5e1"/>
                        <text x={x + 12} y={y + 16} className="assembly-svg-tiny">{fabricationPartDisplayLabel(part.name)} × {part.quantity}</text>
                    </g>;
                })}
            </g>
            <g data-testid="assembly-module" transform={`translate(${moduleTranslate.x.toFixed(1)} ${moduleTranslate.y.toFixed(1)})`}>
                <rect x="0" y="156" width="250" height="40" rx="20" fill="#e2e8f0" stroke="#94a3b8"/>
                {stack.slice(0, 6).map((layer, index) => {
                    const y = 136 - index * 22;
                    const active = index <= currentLayer || step.phase !== 'assemble-module';
                    const entering = step.phase === 'assemble-module' && index === currentLayer;
                    const layerDrop = entering ? (1 - eased) * -36 : 0;
                    const layerOpacity = entering ? 0.45 + 0.55 * eased : active ? 1 : ASSEMBLY_QUIET_OPACITY;
                    return <g key={`${layer.label}-${index}`} className={active && index === currentLayer ? 'assembly-active-layer' : ''} transform={`translate(0 ${layerDrop.toFixed(1)})`} opacity={layerOpacity}>
                        <rect x={24 + index * 6} y={y + 7} width={184} height="28" rx="14" fill="#94a3b8" opacity=".28"/>
                        <rect x={20 + index * 6} y={y} width={184} height="28" rx="14" fill={index === currentLayer ? 'url(#assembly-layer-fill)' : 'url(#assembly-part-depth)'} stroke={index === currentLayer ? '#7c3aed' : '#94a3b8'} strokeWidth="2"/>
                        <circle cx={48 + index * 6} cy={y + 14} r="6" fill="#fff" stroke="#64748b" strokeWidth="2"/>
                        <circle cx={176 + index * 6} cy={y + 14} r="6" fill="#fff" stroke="#64748b" strokeWidth="2"/>
                        {index === currentLayer && <circle cx={214 + index * 6} cy={y + 14} r="9" className="assembly-layer-step-number"/>}
                    </g>;
                })}
                {!stack.length && <g className="assembly-active-layer">
                    <rect x="36" y="94" width="178" height="44" rx="22" fill="url(#assembly-layer-fill)" stroke="#7c3aed" strokeWidth="2"/>
                    <text x="72" y="121" className="assembly-svg-tiny">{recipeTitle} module</text>
                </g>}
            </g>
            <g
                data-testid="assembly-board"
                data-board-mode={boardActive ? 'active' : 'reference'}
                data-board-opacity={boardActive ? '1' : String(ASSEMBLY_REFERENCE_OPACITY)}
                opacity={boardActive ? 1 : ASSEMBLY_REFERENCE_OPACITY}
            >
                <rect x="472" y="120" width="292" height="292" rx="22" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2"/>
                {Array.from({ length: kit.boardCells }).map((_, col) =>
                    <text key={`col-${col}`} x={494 + col * 18} y="116" className="assembly-svg-tiny" textAnchor="middle">{fabricationBoardColumnLabel(col)}</text>
                )}
                {Array.from({ length: kit.boardCells }).map((_, row) =>
                    <text key={`row-${row}`} x="462" y={146 + row * 18} className="assembly-svg-tiny" textAnchor="end">{fabricationBoardRowLabel(row)}</text>
                )}
                {Array.from({ length: kit.boardCells }).map((_, row) => Array.from({ length: kit.boardCells }).map((__, col) =>
                    <circle key={`${row}-${col}`} cx={494 + col * 18} cy={142 + row * 18} r="3.2" fill="#e2e8f0" stroke="#94a3b8"/>
                ))}
                <title>{`${kit.boardCells} by ${kit.boardCells} board, ${kit.gridPitchMm} millimeter grid`}</title>
                {boardCoordEntries.map(({ point, coord }, index) => <g key={`${point.x}-${point.y}-${index}`} className="assembly-active-hole">
                    <circle cx={point.x} cy={point.y} r="13" fill="rgba(139,92,246,.12)" stroke="#8b5cf6" strokeWidth="3"/>
                    <text x={point.x + 12} y={point.y - 10} className="assembly-svg-tiny">{fabricationBoardCoordinateCallout(coord)}</text>
                </g>)}
            </g>
            {floatingCoordEntries.length > 0 && <g data-testid="assembly-floating-references" className="assembly-floating-references">
                <rect x="56" y="388" width="326" height="42" rx="16" fill="rgba(139,92,246,.08)" stroke="#c4b5fd" strokeDasharray="8 6"/>
                {floatingCoordEntries.slice(0, 4).map((entry, index) => (
                    <g key={`${entry.coord}-${entry.role}`} transform={`translate(${88 + index * 68} 409)`}>
                        <circle r="10" fill="#ede9fe" stroke="#8b5cf6" strokeWidth="2"/>
                        <text x="17" y="4" className="assembly-svg-tiny">{fabricationBoardCoordinateCallout(entry.coord).split(' · ')[0]}</text>
                    </g>
                ))}
            </g>}
            {step.phase === 'mount-to-board' && <g className="assembly-mount-motion" data-testid="assembly-mount-motion">
                <path d="M370 272 C430 210 462 206 520 190" fill="none" stroke="#8b5cf6" strokeWidth="6" strokeLinecap="round" markerEnd="url(#assembly-arrow)"/>
                <rect x={primaryBoardPoint.x - 18} y={primaryBoardPoint.y - 18} width="138" height="60" rx="22" fill="rgba(139,92,246,.16)" stroke="#8b5cf6" strokeDasharray="8 7" strokeWidth="3"/>
                <circle cx={primaryBoardPoint.x} cy={primaryBoardPoint.y} r="6" fill="#8b5cf6"/>
            </g>}
            {step.phase === 'connect-character' && <g className="assembly-character-connect" data-testid="assembly-character-connect">
                <path d={`M${primaryBoardPoint.x} ${primaryBoardPoint.y} C${primaryBoardPoint.x + 62} ${primaryBoardPoint.y - 46} 790 180 812 238`} fill="none" stroke="#8b5cf6" strokeWidth="5" strokeLinecap="round" strokeDasharray="12 8" markerEnd="url(#assembly-arrow)"/>
                <rect x="760" y="174" width="100" height="148" rx="28" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="2"/>
                <circle cx="810" cy="210" r="16" fill="#cbd5e1" stroke="#64748b" strokeWidth="3"/>
                <path d="M810 236 L810 286 M810 250 L782 270 M810 250 L838 270" stroke="#64748b" strokeWidth="5" strokeLinecap="round"/>
                <circle cx="812" cy="238" r="9" fill="#8b5cf6" stroke="#fff" strokeWidth="3"/>
            </g>}
            {step.phase === 'test-motion' && <g className="assembly-test-motion">
                <path d={`M${primaryBoardPoint.x + 16} ${primaryBoardPoint.y + 24} C${primaryBoardPoint.x + 56} ${primaryBoardPoint.y - 52} ${primaryBoardPoint.x + 132} ${primaryBoardPoint.y - 36} ${primaryBoardPoint.x + 140} ${primaryBoardPoint.y + 32} C${primaryBoardPoint.x + 146} ${primaryBoardPoint.y + 88} ${primaryBoardPoint.x + 84} ${primaryBoardPoint.y + 104} ${primaryBoardPoint.x + 38} ${primaryBoardPoint.y + 74}`} fill="none" stroke="#22c55e" strokeWidth="5" strokeDasharray="10 8"/>
                <circle data-testid="assembly-motion-dot" cx={motionDot.x.toFixed(1)} cy={motionDot.y.toFixed(1)} r="9" fill="#22c55e" stroke="#fff" strokeWidth="3"/>
            </g>}
        </svg>
    </section>;
};
