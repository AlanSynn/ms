import type { PhysicalKitSettings } from '../../../types';
import type { CharacterAssemblyPin, CharacterAssemblyPlan, CharacterAssemblyStep } from '../../../utils/assemblyPlayback';
import { fabricationBoardColumnLabel, fabricationBoardCoordinateCallout, fabricationBoardRowLabel, fabricationPartDisplayLabel } from '../../../utils/fabrication';
import {
    ASSEMBLY_REFERENCE_OPACITY,
    assemblyCoordToSvg,
    characterBoardProjector,
    characterCanvasProjector,
    smoothAssemblyProgress,
    svgPathFromPoints
} from './assemblyGeometry';


export const CharacterAssemblyWorkbench = ({ plan, step, kit, progress = 0 }: { plan: CharacterAssemblyPlan; step: CharacterAssemblyStep; kit: PhysicalKitSettings; progress?: number }) => {
    const trayProjectPoint = characterCanvasProjector(plan);
    const boardProjector = characterBoardProjector(plan);
    const activePinIds = new Set(step.pinIds);
    const eased = smoothAssemblyProgress(progress);
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
                <span className="blueprint-pill">board pins</span>
                <span className="blueprint-pill">moving joints</span>
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
                        <text x="16" y="5" className="assembly-svg-tiny">moving joint</text>
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
                    <text x="0" y="-8" className="assembly-svg-tiny">{pin.label}</text>
                    {pin.stack.map((label, index) => <g key={`${pin.id}-${label}-${index}`} transform={`translate(${index * 60} 0)`}>
                        <rect x="0" y={index % 2 ? 8 : 0} width="48" height="18" rx="9" fill={pin.role === 'fixed_pin' ? ['#e2e8f0', '#334155', '#fbbf24', '#bfdbfe', '#334155'][index] : ['#bfdbfe', '#fef3c7', '#334155'][index]} stroke="#64748b"/>
                        <text x="24" y="38" className="assembly-svg-tiny" textAnchor="middle">{fabricationPartDisplayLabel(label)}</text>
                    </g>)}
                </g>) : <text x="0" y="12" className="assembly-svg-tiny">Pick pins.</text>}
            </g>
        </svg>
    </section>;
};
