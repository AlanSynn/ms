import type { FabricationRecipe, PhysicalKitSettings } from '../../../types';
import type { AssemblyLane, AssemblyPlaybackStep, CharacterAssemblyPin, CharacterAssemblyPlan, CharacterAssemblyStep } from '../../../utils/assemblyPlayback';
import { fabricationBoardColumnLabel, fabricationBoardCoordinateCallout, fabricationBoardRowLabel, fabricationPartDisplayLabel } from '../../../utils/fabrication';
import { MECHANISM_TEMPLATE_LIBRARY } from '../../../utils/mechanismTemplates';
import { isBoardFixedCoordRole } from '../../../utils/mechanismReference';

const assemblyCoordToSvg = (coord: string) => {
    const match = /^([A-O])([1-9]|1[0-5])$/i.exec(coord.trim());
    if (!match) return null;
    return { x: 494 + (match[1].toUpperCase().charCodeAt(0) - 65) * 18, y: 142 + (Number(match[2]) - 1) * 18 };
};

const smooth = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
};

const ASSEMBLY_REFERENCE_OPACITY = 0.86;
const ASSEMBLY_QUIET_OPACITY = 0.72;

const pointBounds = (points: Array<{ x: number; y: number }>) => {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
    };
};

const characterCanvasProjector = (plan: CharacterAssemblyPlan) => {
    const allPoints = plan.parts.flatMap(part => [...part.outline, part.pivot]);
    const bounds = allPoints.length ? pointBounds(allPoints) : { minX: -120, maxX: 120, minY: -160, maxY: 160, width: 240, height: 320 };
    const scale = Math.min(300 / Math.max(1, bounds.width), 360 / Math.max(1, bounds.height));
    const offsetX = 246 - (bounds.minX + bounds.width / 2) * scale;
    const offsetY = 286 - (bounds.minY + bounds.height / 2) * scale;
    return (point: { x: number; y: number }) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY });
};

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const characterBoardProjector = (plan: CharacterAssemblyPlan) => {
    const allPoints = plan.parts.flatMap(part => [...part.outline, part.pivot]);
    const bounds = allPoints.length ? pointBounds(allPoints) : { minX: -120, maxX: 120, minY: -160, maxY: 160, width: 240, height: 320 };
    const fitScale = Math.min(220 / Math.max(1, bounds.width), 248 / Math.max(1, bounds.height));
    const anchoredPins = plan.fixedPins
        .map(pin => ({ pin, board: pin.boardCoordinate ? assemblyCoordToSvg(pin.boardCoordinate) : null }))
        .filter((entry): entry is { pin: CharacterAssemblyPlan['fixedPins'][number]; board: { x: number; y: number } } => Boolean(entry.board));
    const pair = anchoredPins.flatMap((first, firstIndex) =>
        anchoredPins.slice(firstIndex + 1).map(second => ({ first, second }))
    ).find(({ first, second }) => distance(first.pin.scene, second.pin.scene) > 1 && distance(first.board, second.board) > 1);
    if (pair) {
        const sceneAngle = Math.atan2(pair.second.pin.scene.y - pair.first.pin.scene.y, pair.second.pin.scene.x - pair.first.pin.scene.x);
        const boardAngle = Math.atan2(pair.second.board.y - pair.first.board.y, pair.second.board.x - pair.first.board.x);
        const scale = distance(pair.first.board, pair.second.board) / distance(pair.first.pin.scene, pair.second.pin.scene);
        const rotation = boardAngle - sceneAngle;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
            anchorPinId: pair.first.pin.id,
            anchorBoardCoordinate: pair.first.pin.boardCoordinate,
            project: (point: { x: number; y: number }) => {
                const x = (point.x - pair.first.pin.scene.x) * scale;
                const y = (point.y - pair.first.pin.scene.y) * scale;
                return {
                    x: pair.first.board.x + x * cos - y * sin,
                    y: pair.first.board.y + x * sin + y * cos
                };
            }
        };
    }
    const anchor = anchoredPins[0];
    if (anchor) {
        return {
            anchorPinId: anchor.pin.id,
            anchorBoardCoordinate: anchor.pin.boardCoordinate,
            project: (point: { x: number; y: number }) => ({
                x: anchor.board.x + (point.x - anchor.pin.scene.x) * fitScale,
                y: anchor.board.y + (point.y - anchor.pin.scene.y) * fitScale
            })
        };
    }
    const offsetX = 618 - (bounds.minX + bounds.width / 2) * fitScale;
    const offsetY = 266 - (bounds.minY + bounds.height / 2) * fitScale;
    return {
        anchorPinId: undefined,
        anchorBoardCoordinate: undefined,
        project: (point: { x: number; y: number }) => ({ x: point.x * fitScale + offsetX, y: point.y * fitScale + offsetY })
    };
};

const svgPathFromPoints = (points: Array<{ x: number; y: number }>, project: (point: { x: number; y: number }) => { x: number; y: number }) => {
    if (!points.length) return '';
    const projected = points.map(project);
    return `M ${projected[0].x.toFixed(1)} ${projected[0].y.toFixed(1)} ${projected.slice(1).map(point => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} Z`;
};

export const AssemblyWorkbench = ({ recipe, lane, step, kit, progress = 0 }: { recipe: FabricationRecipe; lane: AssemblyLane; step: AssemblyPlaybackStep; kit: PhysicalKitSettings; progress?: number }) => {
    const eased = smooth(progress);
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
    const activeLayerLabel = stack[currentLayer]?.label ? fabricationPartDisplayLabel(stack[currentLayer].label) : `${recipe.type.replace(/[-_]/g, ' ')} module`;
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
        <svg className="assembly-workbench-svg" viewBox="0 0 900 560" role="img" aria-label={`${recipe.type} assembly step ${step.index}`}>
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
                    <text x="72" y="121" className="assembly-svg-tiny">{recipe.type.replace(/[-_]/g, ' ')} module</text>
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

export const CharacterAssemblyWorkbench = ({ plan, step, kit, progress = 0 }: { plan: CharacterAssemblyPlan; step: CharacterAssemblyStep; kit: PhysicalKitSettings; progress?: number }) => {
    const trayProjectPoint = characterCanvasProjector(plan);
    const boardProjector = characterBoardProjector(plan);
    const activePinIds = new Set(step.pinIds);
    const eased = smooth(progress);
    const mountedProgress = step.phase === 'attach-character' ? 0.35 + eased * 0.65 : step.phase === 'test-character' ? 1 : 0;
    const layerState = mountedProgress >= 1 ? 'mounted' : mountedProgress > 0 ? 'moving-to-board' : 'parts-tray';
    const projectPoint = (point: { x: number; y: number }) => {
        const trayPoint = trayProjectPoint(point);
        const boardPoint = boardProjector.project(point);
        return {
            x: trayPoint.x + (boardPoint.x - trayPoint.x) * mountedProgress,
            y: trayPoint.y + (boardPoint.y - trayPoint.y) * mountedProgress
        };
    };
    const offBoardFixedPins = plan.fixedPins.filter(pin => !pin.boardCoordinate || pin.board?.valid === false);
    const activeFixedPin = plan.fixedPins.find(pin => activePinIds.has(pin.id)) ?? plan.fixedPins[0];
    const activeFreePivot = plan.freePivots.find(pin => activePinIds.has(pin.id)) ?? plan.freePivots[0];
    const activeStackPins = step.phase === 'character-parts'
        ? []
        : step.phase === 'free-pivots'
            ? (activeFreePivot ? [activeFreePivot] : [])
            : step.phase === 'fixed-pins'
                ? (activeFixedPin ? [activeFixedPin] : [])
                : [activeFixedPin, activeFreePivot].filter((pin): pin is CharacterAssemblyPin => Boolean(pin));
    return <section
        className="assembly-stepper-workbench character-assembly-workbench"
        data-testid="character-assembly-workbench"
        data-assembly-kind="character"
        data-fixed-pin-count={plan.fixedPins.length}
        data-free-pivot-count={plan.freePivots.length}
        data-off-board-fixed-pin-count={offBoardFixedPins.length}
        data-active-character-step={step.phase}
        data-step-progress={Math.round(progress * 100)}
        aria-label="Character assembly workbench"
    >
        <div className="assembly-workbench-head">
            <div>
                <div className="section-title">Character assembly</div>
                <h3>{step.label}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
                <span className="blueprint-pill">fixed pins {plan.fixedPins.length}</span>
                <span className="blueprint-pill">free pivots {plan.freePivots.length}</span>
            </div>
        </div>
        <svg className="assembly-workbench-svg" viewBox="0 0 900 560" role="img" aria-label={`Character assembly step ${step.index}`}>
            <title>{`${step.label} · character board assembly`}</title>
            <defs>
                <filter id="character-pin-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#64748b" floodOpacity=".2"/></filter>
            </defs>
            <rect x="38" y="84" width="410" height="382" rx="30" fill="#ffffff" stroke="#dbe3f1"/>
            <g data-testid="character-assembly-board" opacity={step.phase === 'character-parts' ? ASSEMBLY_REFERENCE_OPACITY : 1}>
                <rect x="472" y="120" width="292" height="292" rx="22" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2"/>
                {Array.from({ length: kit.boardCells }).map((_, col) =>
                    <text key={`character-col-${col}`} x={494 + col * 18} y="116" className="assembly-svg-tiny" textAnchor="middle">{fabricationBoardColumnLabel(col)}</text>
                )}
                {Array.from({ length: kit.boardCells }).map((_, row) =>
                    <text key={`character-row-${row}`} x="462" y={146 + row * 18} className="assembly-svg-tiny" textAnchor="end">{fabricationBoardRowLabel(row)}</text>
                )}
                {Array.from({ length: kit.boardCells }).map((_, row) => Array.from({ length: kit.boardCells }).map((__, col) =>
                    <circle key={`character-hole-${row}-${col}`} cx={494 + col * 18} cy={142 + row * 18} r="3.2" fill="#e2e8f0" stroke="#94a3b8"/>
                ))}
            </g>
            <g
                data-testid="character-board-layer"
                data-layer-state={layerState}
                data-anchored-pin={boardProjector.anchorPinId ?? ''}
                data-board-coordinate={boardProjector.anchorBoardCoordinate ?? ''}
            >
                <g data-testid="character-pin-alignment" opacity={['fixed-pins', 'attach-character', 'test-character'].includes(step.phase) ? 1 : 0.18}>
                    {plan.fixedPins.map(pin => {
                        const partPoint = projectPoint(pin.scene);
                        const boardPoint = pin.boardCoordinate ? assemblyCoordToSvg(pin.boardCoordinate) : null;
                        if (!boardPoint) return null;
                        return <line
                            key={`align-${pin.id}`}
                            x1={partPoint.x.toFixed(1)}
                            y1={partPoint.y.toFixed(1)}
                            x2={boardPoint.x.toFixed(1)}
                            y2={boardPoint.y.toFixed(1)}
                            stroke="#f59e0b"
                            strokeWidth="2"
                            strokeDasharray="7 6"
                        />;
                    })}
                </g>
                <g data-testid="character-assembly-parts">
                    {plan.parts.map(part => (
                        <path
                            key={part.id}
                            d={svgPathFromPoints(part.outline, projectPoint)}
                            fill={part.fillColor}
                            fillOpacity="0.82"
                            stroke="#64748b"
                            strokeWidth="2"
                            strokeLinejoin="round"
                            data-character-part={part.id}
                        />
                    ))}
                </g>
            </g>
            <g data-testid="character-free-pivots">
                {plan.freePivots.map(pin => {
                    const point = projectPoint(pin.scene);
                    const active = activePinIds.has(pin.id) || ['free-pivots', 'attach-character', 'test-character'].includes(step.phase);
                    return <g key={pin.id} transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`} opacity={active ? 1 : 0.34}>
                        <circle r="15" fill="rgba(14,165,233,.1)" stroke="#0ea5e9" strokeWidth="3" strokeDasharray="6 4"/>
                        <circle r="6" fill="#ffffff" stroke="#0ea5e9" strokeWidth="2"/>
                        <text x="16" y="5" className="assembly-svg-tiny">free pivot</text>
                    </g>;
                })}
            </g>
            <g data-testid="character-fixed-pins">
                {plan.fixedPins.map(pin => {
                    const partPoint = projectPoint(pin.scene);
                    const boardPoint = pin.boardCoordinate ? assemblyCoordToSvg(pin.boardCoordinate) : null;
                    const active = activePinIds.has(pin.id) || ['fixed-pins', 'attach-character', 'test-character'].includes(step.phase);
                    return <g key={pin.id} opacity={active ? 1 : 0.38}>
                        <g transform={`translate(${partPoint.x.toFixed(1)} ${partPoint.y.toFixed(1)})`}>
                            <circle r="14" fill="#f59e0b" fillOpacity=".22" stroke="#d97706" strokeWidth="3"/>
                            <circle r="6" fill="#d97706" stroke="#fff" strokeWidth="2"/>
                        </g>
                        {boardPoint && <g data-board-coordinate={pin.boardCoordinate} transform={`translate(${boardPoint.x.toFixed(1)} ${boardPoint.y.toFixed(1)})`} filter="url(#character-pin-shadow)">
                            <circle r="16" fill="#fbbf24" stroke="#b45309" strokeWidth="3"/>
                            <circle r="6" fill="#334155"/>
                            <text x="20" y="5" className="assembly-svg-tiny">{fabricationBoardCoordinateCallout(pin.boardCoordinate ?? '')}</text>
                        </g>}
                    </g>;
                })}
            </g>
            {offBoardFixedPins.length > 0 && <g data-testid="character-off-board-warning" transform="translate(514 96)">
                <rect width="256" height="40" rx="16" fill="#fef3c7" stroke="#f59e0b"/>
                <text x="18" y="25" className="assembly-svg-tiny">Move fixed pins onto board.</text>
            </g>}
            <g
                data-testid="character-assembly-stack"
                data-active-stack-roles={activeStackPins.map(pin => pin.role).join(',')}
                data-active-stack-parts={activeStackPins.flatMap(pin => pin.stack).join('>')}
                transform="translate(500 432)"
            >
                {activeStackPins.length ? activeStackPins.map((pin, pinIndex) => <g
                    key={`stack-${pin.id}`}
                    data-testid="character-pin-stack"
                    data-pin-role={pin.role}
                    data-stack-parts={pin.stack.join('>')}
                    transform={`translate(0 ${pinIndex * 52})`}
                >
                    <text x="0" y="-8" className="assembly-svg-tiny">{pin.role === 'fixed_pin' ? 'fixed' : 'free'} · {pin.label}</text>
                    {pin.stack.map((label, index) => <g key={`${pin.id}-${label}-${index}`} transform={`translate(${index * 60} 0)`}>
                        <rect x="0" y={index % 2 ? 8 : 0} width="48" height="18" rx="9" fill={pin.role === 'fixed_pin' ? ['#e2e8f0', '#334155', '#fbbf24', '#bfdbfe', '#334155'][index] : ['#bfdbfe', '#fef3c7', '#334155'][index]} stroke="#64748b"/>
                        <text x="24" y="38" className="assembly-svg-tiny" textAnchor="middle">{fabricationPartDisplayLabel(label)}</text>
                    </g>)}
                </g>) : <text x="0" y="12" className="assembly-svg-tiny">Pick pins.</text>}
            </g>
        </svg>
    </section>;
};
