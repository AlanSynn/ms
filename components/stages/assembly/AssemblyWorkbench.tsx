import type { FabricationRecipe, PhysicalKitSettings } from '../../../types';
import type { AssemblyLane, AssemblyPlaybackStep } from '../../../utils/assemblyPlayback';

const assemblyCoordToSvg = (coord: string) => {
    const match = /^([A-O])([1-9]|1[0-5])$/i.exec(coord.trim());
    if (!match) return null;
    return { x: 494 + (match[1].toUpperCase().charCodeAt(0) - 65) * 18, y: 142 + (Number(match[2]) - 1) * 18 };
};

export const AssemblyWorkbench = ({ recipe, lane, step, kit }: { recipe: FabricationRecipe; lane: AssemblyLane; step: AssemblyPlaybackStep; kit: PhysicalKitSettings }) => {
    const boardVisible = lane === 'kit' && ['mount-to-board', 'connect-character', 'test-motion'].includes(step.phase);
    const stack = step.stack.length ? step.stack : recipe.assemblySteps.flatMap(item => item.stack ?? []).slice(0, 5);
    const activeCoords = step.coords.map(assemblyCoordToSvg).filter(Boolean) as Array<{ x: number; y: number }>;
    const currentLayer = Math.max(0, Math.min(stack.length - 1, step.phase === 'assemble-module' ? step.index - 2 : stack.length - 1));
    return <section className="assembly-stepper-workbench" data-testid="assembly-stepper-workbench" aria-label="Interactive assembly workbench">
        <div className="assembly-workbench-head">
            <div>
                <div className="section-title">Assembly</div>
                <h3>{step.label}</h3>
            </div>
            <span className="blueprint-pill">{lane === 'kit' ? `${kit.boardCells}×${kit.boardCells} board` : 'custom parts'}</span>
        </div>
        <svg className="assembly-workbench-svg" viewBox="0 0 900 560" role="img" aria-label={`${recipe.type} assembly step ${step.index}`}>
            <defs>
                <linearGradient id="assembly-layer-fill" x1="0" x2="1"><stop offset="0" stopColor="#dbeafe"/><stop offset="1" stopColor="#a78bfa"/></linearGradient>
                <marker id="assembly-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#8b5cf6"/></marker>
            </defs>
            <rect x="28" y="78" width="388" height="370" rx="28" fill="#fff" stroke="#dbe3f1"/>
            <text x="56" y="118" className="assembly-svg-label">Mechanism first</text>
            <g data-testid="assembly-module" transform="translate(108 162)">
                <rect x="0" y="156" width="250" height="40" rx="20" fill="#e2e8f0" stroke="#94a3b8"/>
                {stack.slice(0, 6).map((layer, index) => {
                    const y = 136 - index * 22;
                    const active = index <= currentLayer || step.phase !== 'assemble-module';
                    return <g key={`${layer.label}-${index}`} className={active && index === currentLayer ? 'assembly-active-layer' : ''} opacity={active ? 1 : 0.22}>
                        <rect x={20 + index * 7} y={y} width={190} height="28" rx="14" fill={index === currentLayer ? 'url(#assembly-layer-fill)' : '#eef2f7'} stroke={index === currentLayer ? '#7c3aed' : '#94a3b8'} strokeWidth="2"/>
                        <circle cx={48 + index * 7} cy={y + 14} r="6" fill="#fff" stroke="#64748b" strokeWidth="2"/>
                        <circle cx={178 + index * 7} cy={y + 14} r="6" fill="#fff" stroke="#64748b" strokeWidth="2"/>
                        <text x={230} y={y + 18} className="assembly-svg-tiny">{layer.part ?? layer.label}</text>
                    </g>;
                })}
                {!stack.length && <g className="assembly-active-layer">
                    <rect x="36" y="94" width="178" height="44" rx="22" fill="url(#assembly-layer-fill)" stroke="#7c3aed" strokeWidth="2"/>
                    <text x="72" y="121" className="assembly-svg-tiny">{recipe.type} module</text>
                </g>}
            </g>
            <g data-testid="assembly-board" opacity={boardVisible ? 1 : 0.16}>
                <rect x="472" y="120" width="292" height="292" rx="22" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2"/>
                {Array.from({ length: kit.boardCells }).map((_, row) => Array.from({ length: kit.boardCells }).map((__, col) =>
                    <circle key={`${row}-${col}`} cx={494 + col * 18} cy={142 + row * 18} r="3.2" fill="#e2e8f0" stroke="#94a3b8"/>
                ))}
                <text x="492" y="102" className="assembly-svg-label">{kit.boardCells}×{kit.boardCells} board · {kit.gridPitchMm}mm</text>
                {activeCoords.map((point, index) => <g key={`${point.x}-${point.y}-${index}`} className="assembly-active-hole">
                    <circle cx={point.x} cy={point.y} r="13" fill="rgba(139,92,246,.12)" stroke="#8b5cf6" strokeWidth="3"/>
                    <text x={point.x + 12} y={point.y - 10} className="assembly-svg-tiny">{step.coords[index]}</text>
                </g>)}
            </g>
            {step.phase === 'mount-to-board' && <g className="assembly-mount-motion">
                <path d="M370 272 C430 210 462 206 520 190" fill="none" stroke="#8b5cf6" strokeWidth="6" strokeLinecap="round" markerEnd="url(#assembly-arrow)"/>
                <rect x="512" y="176" width="126" height="54" rx="22" fill="rgba(139,92,246,.16)" stroke="#8b5cf6" strokeDasharray="8 7" strokeWidth="3"/>
            </g>}
            {step.phase === 'test-motion' && <g className="assembly-test-motion">
                <path d="M560 238 C610 176 680 188 706 252 C728 306 676 356 616 326" fill="none" stroke="#22c55e" strokeWidth="5" strokeDasharray="10 8"/>
                <circle cx="704" cy="252" r="8" fill="#22c55e"/>
            </g>}
        </svg>
    </section>;
};
