
import React, { useEffect, useRef, useState } from 'react';
import { BodyPartLayer, CanvasViewport, GlobalConfig, MechanismConfig, Point, ProjectState } from '../types';
import { calculateLinkage, generateCurvePoints } from '../utils/kinematics';
import { boardGridLines, bodyPartPivotScene, defaultPhysicalKit, pathFromPoints, SCENE_VIEW, sceneBoundsForSheet, sceneToSvg } from '../utils/coordinates';
import { motionPreviewForProject, pointOnProjectPath } from '../utils/motion';
import { mechanismWithGeneratedPath } from '../utils/project';
import { clampCanvasZoom } from '../utils/viewport';

interface CanvasProps {
    project?: ProjectState;
    config: GlobalConfig;
    setConfig: React.Dispatch<React.SetStateAction<GlobalConfig>>;
    selectedId: string | null;
    setSelectedId: (id: string | null) => void;
    isPlaying: boolean;
    showTrace: boolean;
    isDrawMode: boolean;
    userPath: Point[];
    setUserPath: (path: Point[]) => void;
    angle: number;
    setAngle: React.Dispatch<React.SetStateAction<number>>;
    viewport?: CanvasViewport;
    setViewport?: React.Dispatch<React.SetStateAction<CanvasViewport>>;
}

const VB_WIDTH = SCENE_VIEW.width;
const VB_HEIGHT = SCENE_VIEW.height;
const SCENE_ORIGIN = sceneToSvg({ x: 0, y: 0 });
const INITIAL_OFFSET_X = SCENE_ORIGIN.x;
const INITIAL_OFFSET_Y = SCENE_ORIGIN.y;

const GearPath = ({ radius, teeth }: { radius: number, teeth: number }) => {
    const hole = radius * 0.2;
    const outer = radius;
    const inner = radius * 0.85;
    let d = "";
    for (let i = 0; i < teeth; i++) {
        const angle = (Math.PI * 2 * i) / teeth;
        const toothWidth = (Math.PI * 2) / teeth / 2;
        const a1 = angle;
        const a2 = angle + toothWidth * 0.3;
        const a3 = angle + toothWidth * 0.7;
        const a4 = angle + toothWidth;
        const p1 = { x: Math.cos(a1) * inner, y: Math.sin(a1) * inner };
        const p2 = { x: Math.cos(a2) * outer, y: Math.sin(a2) * outer };
        const p3 = { x: Math.cos(a3) * outer, y: Math.sin(a3) * outer };
        const p4 = { x: Math.cos(a4) * inner, y: Math.sin(a4) * inner };
        d += i === 0 ? `M ${p1.x} ${p1.y} ` : `L ${p1.x} ${p1.y} `;
        d += `L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} L ${p4.x} ${p4.y} `;
    }
    d += `Z M ${hole} 0 A ${hole} ${hole} 0 1 0 -${hole} 0 A ${hole} ${hole} 0 1 0 ${hole} 0 Z`;
    return <path d={d} fillRule="evenodd" />;
};

export const Canvas: React.FC<CanvasProps> = ({
    project, config, setConfig, selectedId, setSelectedId, isPlaying, showTrace, isDrawMode, userPath, setUserPath, angle, setAngle, viewport, setViewport
}) => {
    const [traces, setTraces] = useState<Record<string, Point[]>>({});
    const svgRef = useRef<SVGSVGElement>(null);

    const [internalViewport, setInternalViewport] = useState<CanvasViewport>({ offset: { x: 0, y: 0 }, zoom: 1 });
    const activeViewport = viewport ?? internalViewport;
    const viewOffset = activeViewport.offset;
    const zoom = activeViewport.zoom;
    const writeViewport = setViewport ?? setInternalViewport;
    const setViewOffset = (next: Point | ((prev: Point) => Point)) => {
        writeViewport(prev => ({ ...prev, offset: typeof next === 'function' ? next(prev.offset) : next }));
    };
    const setZoom = (nextZoom: number) => {
        writeViewport(prev => ({ ...prev, zoom: nextZoom }));
    };
    const [isPanning, setIsPanning] = useState(false);
    const [isDrawing, setIsDrawing] = useState(false);
    const [dragTarget, setDragTarget] = useState<{ mechId: string, type: 'P1' | 'P2' | 'J1' | 'J2' | 'Effector' | 'Aux' } | null>(null);

    // User path selection state
    const [isPathSelected, setIsPathSelected] = useState(false);
    const [pathDragAction, setPathDragAction] = useState<'move' | 'resize' | null>(null);
    const [pathDragStart, setPathDragStart] = useState<Point | null>(null);
    const [isHoveringPath, setIsHoveringPath] = useState(false);

    const canDragJ2 = (m: MechanismConfig) => ['4bar', 'piston', 'yoke', 'quick-return', '5bar', 'gear', 'planetary_gear'].includes(m.type);
    const canDragP2 = (m: MechanismConfig) => ['4bar', '5bar', 'piston', 'yoke', 'quick-return', 'cam', 'gear'].includes(m.type);
    const canDragEffector = (m: MechanismConfig) => !['crank', 'cam'].includes(m.type);
    const activeMechanisms = config.mechanisms.filter(m => m.visible && m.enabled !== false);
    const activeMechanismIds = new Set(activeMechanisms.map(m => m.id));
    const motionPreview = project ? motionPreviewForProject(project, activeMechanisms, angle) : undefined;
    const animatedParts = motionPreview?.parts ?? {};
    const groundDragHandle = (m: MechanismConfig, state: ReturnType<typeof calculateLinkage>) => {
        if (m.type === 'piston' || m.type === 'yoke' || m.type === 'quick-return' || m.type === 'cam') {
            const rad = (m.groundAngle || 0) * Math.PI / 180;
            const d = m.type === 'quick-return' ? 120 : 100;
            return { x: state.p1.x + Math.cos(rad) * d, y: state.p1.y + Math.sin(rad) * d };
        }
        return state.p2;
    };

    // Calculate bounding box for userPath
    const getPathBounds = () => {
        if (userPath.length === 0) return null;
        const xs = userPath.map(p => p.x);
        const ys = userPath.map(p => p.y);
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    };

    // Trace Logic
    useEffect(() => {
        if (!isPlaying) {
            // Generate full static traces
            const newTraces: Record<string, Point[]> = {};
            activeMechanisms.forEach(m => {
                if (m.type !== 'crank') {
                    newTraces[m.id] = generateCurvePoints(m, 100).points;
                }
            });
            setTraces(newTraces);
        } else {
            // Clear for realtime
            setTraces({});
        }
    }, [config, isPlaying]);

    useEffect(() => {
        if (isPlaying && !isDrawMode && showTrace) {
            // Realtime appending
            activeMechanisms.forEach(m => {
                const state = calculateLinkage(m, angle);
                if (state.isValid && m.type !== 'crank') {
                    setTraces(prev => {
                        const current = prev[m.id] || [];
                        const updated = [...current, state.effector];
                        if (updated.length > 300) updated.shift();
                        return { ...prev, [m.id]: updated };
                    });
                }
            });
        }
    }, [angle, showTrace, isPlaying, isDrawMode]);

    const getWorldPoint = (e: React.MouseEvent | React.TouchEvent): Point | null => {
        if (!svgRef.current) return null;
        const svg = svgRef.current;
        const pt = svg.createSVGPoint();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        pt.x = clientX;
        pt.y = clientY;
        const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());

        const Tx = INITIAL_OFFSET_X + viewOffset.x;
        const Ty = INITIAL_OFFSET_Y + viewOffset.y;

        return {
            x: (svgP.x - Tx) / zoom,
            y: (Ty - svgP.y) / zoom
        };
    };

    const updateMechanism = (id: string, updates: Partial<MechanismConfig>) => {
        setConfig(prev => ({
            ...prev,
            mechanisms: prev.mechanisms.map(m => m.id === id ? mechanismWithGeneratedPath({ ...m, ...updates }) : m)
        }));
    };

    useEffect(() => {
        if (dragTarget && (!activeMechanisms.some(m => m.id === dragTarget.mechId) || selectedId !== dragTarget.mechId)) setDragTarget(null);
    }, [config.mechanisms, selectedId, dragTarget]);

    const handleWheel = (e: React.WheelEvent) => {
        if (!svgRef.current) return;

        const zoomSensitivity = 0.001;
        // Calculate new zoom
        const delta = -e.deltaY;
        const scaleFactor = 1 + delta * zoomSensitivity;
        const newZoom = clampCanvasZoom(zoom * scaleFactor);

        // Calculate point under mouse in SVG ViewBox coordinates
        const pt = svgRef.current.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgP = pt.matrixTransform(svgRef.current.getScreenCTM()?.inverse());

        // Current transform params
        const Tx = INITIAL_OFFSET_X + viewOffset.x;
        const Ty = INITIAL_OFFSET_Y + viewOffset.y;

        // Calculate World Point under mouse before zoom
        const wx = (svgP.x - Tx) / zoom;
        const wy = (Ty - svgP.y) / zoom;

        // Calculate New Translation to keep World Point under mouse
        const newTx = svgP.x - wx * newZoom;
        const newTy = svgP.y + wy * newZoom;

        setZoom(newZoom);
        setViewOffset({
            x: newTx - INITIAL_OFFSET_X,
            y: newTy - INITIAL_OFFSET_Y
        });
    };

    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        if ('button' in e && (e as React.MouseEvent).button === 1) {
            setIsPanning(true);
            e.preventDefault();
            return;
        }
        const p = getWorldPoint(e);
        if (!p) return;

        // Deselect path if clicking elsewhere
        if (isPathSelected) {
            setIsPathSelected(false);
        }

        if (!isPlaying && !isDrawMode) {
            const HIT_RADIUS = 20 / zoom; // Adjust hit radius by zoom
            const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

            // Check all mechanisms (reverse order to grab top-most)
            for (let i = activeMechanisms.length - 1; i >= 0; i--) {
                const m = activeMechanisms[i];
                const state = calculateLinkage(m, angle);

                // Check Effector
                if (canDragEffector(m) && dist(p, state.effector) < HIT_RADIUS) {
                    setDragTarget({ mechId: m.id, type: 'Effector' });
                    setSelectedId(m.id);
                    return;
                }

                // Check Aux (Secondary Crank Tip for 5-bar)
                if (m.type === '5bar' && state.aux && dist(p, state.aux) < HIT_RADIUS) {
                    setDragTarget({ mechId: m.id, type: 'Aux' });
                    setSelectedId(m.id);
                    return;
                }

                // Check J2 (Joint/Slider/Intersection)
                if (canDragJ2(m) && dist(p, state.j2) < HIT_RADIUS) {
                    setDragTarget({ mechId: m.id, type: 'J2' });
                    setSelectedId(m.id);
                    return;
                }
                // Check J1 (Crank Pin)
                if (dist(p, state.j1) < HIT_RADIUS) {
                    setDragTarget({ mechId: m.id, type: 'J1' });
                    setSelectedId(m.id);
                    return;
                }

                // Check P2 (Ground / Angle Handle / Secondary Gear)
                const groundHandle = groundDragHandle(m, state);

                if (canDragP2(m) && dist(p, groundHandle) < HIT_RADIUS) {
                    setDragTarget({ mechId: m.id, type: 'P2' });
                    setSelectedId(m.id);
                    return;
                }

                // Check P1 (Anchor/Crank Pivot)
                if (dist(p, state.p1) < HIT_RADIUS * 1.5) {
                    setDragTarget({ mechId: m.id, type: 'P1' });
                    setSelectedId(m.id);
                    return;
                }
            }
        }

        if (isDrawMode) {
            setIsDrawing(true);
            setUserPath([p]);
        }
    };

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (isPanning) {
            const movementX = 'movementX' in e ? (e as React.MouseEvent).movementX : 0;
            const movementY = 'movementY' in e ? (e as React.MouseEvent).movementY : 0;
            if (movementX !== undefined) {
                setViewOffset(prev => ({ x: prev.x + movementX, y: prev.y + movementY }));
            }
            return;
        }

        let p = getWorldPoint(e);
        if (!p) return;

        if (dragTarget && !isPlaying) {
            const m = config.mechanisms.find(mech => mech.id === dragTarget.mechId);
            if (!m) return;

            const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
            const toDeg = (rad: number) => (rad * 180) / Math.PI;
            const state = calculateLinkage(m, angle);

            if (dragTarget.type === 'P1') {
                // Move the entire mechanism anchor
                updateMechanism(m.id, { anchorX: p.x, anchorY: p.y });
            }
            else if (dragTarget.type === 'P2') {
                // Interaction: Rotate Ground / Change Ground Length
                const dx = p.x - state.p1.x;
                const dy = p.y - state.p1.y;
                const newAngle = toDeg(Math.atan2(dy, dx));

                if (m.type === '4bar' || m.type === '5bar' || m.type === 'gear') {
                    const newGround = Math.hypot(dx, dy);
                    updateMechanism(m.id, { groundLength: newGround, groundAngle: newAngle });
                } else {
                    updateMechanism(m.id, { groundAngle: newAngle });
                }
            }
            else if (dragTarget.type === 'J1') {
                const newCrank = dist(state.p1, p);
                const newAngle = Math.atan2(p.y - state.p1.y, p.x - state.p1.x);
                updateMechanism(m.id, { crankLength: newCrank });
                setAngle(newAngle);
            }
            else if (dragTarget.type === 'Aux') {
                const newRadius = dist(state.p2, p);
                updateMechanism(m.id, { rockerLength: newRadius });
            }
            else if (dragTarget.type === 'J2') {
                if (m.type === '4bar') {
                    const newRocker = dist(state.p2, p);
                    const newCoupler = dist(state.j1, p);
                    updateMechanism(m.id, { rockerLength: newRocker, couplerLength: newCoupler });
                } else if (m.type === 'piston') {
                    const newCoupler = dist(state.j1, p);
                    updateMechanism(m.id, { couplerLength: newCoupler });
                } else if (m.type === 'yoke') {
                    const limit = m.crankLength - 2;
                    const dY = p.y - state.p1.y;
                    const safeY = Math.max(-limit, Math.min(limit, dY));
                    updateMechanism(m.id, { sliderOffset: safeY });
                } else if (m.type === '5bar') {
                    const newCoupler = dist(state.j1, p);
                    const newRod = state.aux ? dist(state.aux, p) : 100;
                    updateMechanism(m.id, { couplerLength: newCoupler, rodLength: newRod });
                } else if (m.type === 'quick-return' || m.type === 'gear' || m.type === 'planetary_gear') {
                    updateMechanism(m.id, { rockerLength: dist(state.p2, p) });
                }
            }
            else if (dragTarget.type === 'Effector') {
                if (canDragEffector(m)) {
                    if (m.type === '5bar') {
                        const newExtension = dist(state.j2, p);
                        updateMechanism(m.id, { couplerPointDist: newExtension });
                    } else if (m.type === 'gear' || m.type === 'planetary_gear') {
                        const baseAngle = Math.atan2(state.j2.y - state.p2.y, state.j2.x - state.p2.x);
                        const mouseAngle = Math.atan2(p.y - state.j2.y, p.x - state.j2.x);
                        updateMechanism(m.id, { couplerPointDist: dist(state.j2, p), couplerPointAngle: toDeg(mouseAngle - baseAngle) });
                    } else {
                        const barAngle = Math.atan2(state.j2.y - state.j1.y, state.j2.x - state.j1.x);
                        const mouseAngle = Math.atan2(p.y - state.j1.y, p.x - state.j1.x);
                        const newDist = dist(state.j1, p);
                        const newAngleDiff = toDeg(mouseAngle - barAngle);
                        updateMechanism(m.id, { couplerPointDist: newDist, couplerPointAngle: newAngleDiff });
                    }
                }
            }
        }

        if (isDrawMode && isDrawing) {
            const isShift = (e as any).shiftKey;
            if (isShift && userPath.length > 0) {
                const last = userPath[userPath.length - 1];
                const dx = Math.abs(p.x - last.x);
                const dy = Math.abs(p.y - last.y);
                if (dx > dy) p = { x: p.x, y: last.y };
                else p = { x: last.x, y: p.y };
            }
            const last = userPath[userPath.length - 1];
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 5) {
                setUserPath([...userPath, p]);
            }
        }

        // Handle path move/resize drag
        if (pathDragAction && pathDragStart && userPath.length > 0) {
            const bounds = getPathBounds();
            if (!bounds) return;

            if (pathDragAction === 'move') {
                // Move entire path
                const dx = p.x - pathDragStart.x;
                const dy = p.y - pathDragStart.y;
                setUserPath(userPath.map(pt => ({ x: pt.x + dx, y: pt.y + dy })));
                setPathDragStart(p);
            } else if (pathDragAction === 'resize') {
                // Resize from bottom-right corner
                const centerX = (bounds.minX + bounds.maxX) / 2;
                const centerY = (bounds.minY + bounds.maxY) / 2;
                const oldDist = Math.hypot(pathDragStart.x - centerX, pathDragStart.y - centerY);
                const newDist = Math.hypot(p.x - centerX, p.y - centerY);
                if (oldDist > 0) {
                    const scale = newDist / oldDist;
                    setUserPath(userPath.map(pt => ({
                        x: centerX + (pt.x - centerX) * scale,
                        y: centerY + (pt.y - centerY) * scale
                    })));
                    setPathDragStart(p);
                }
            }
        }
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        setIsPanning(false);
        setDragTarget(null);
        setPathDragAction(null);
        setPathDragStart(null);
    };

    const crankDeg = (angle * 180) / Math.PI;

    return (
        <div
            className={`w-full h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative select-none ${isDrawMode ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            onWheel={handleWheel}
            tabIndex={0}
        >
            <svg
                ref={svgRef}
                aria-label="Mechanism design canvas"
                data-testid="design-canvas"
                viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
                className={`w-full h-full ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
                preserveAspectRatio="xMidYMid slice"
            >
                <g transform={`translate(${INITIAL_OFFSET_X + viewOffset.x}, ${INITIAL_OFFSET_Y + viewOffset.y}) scale(${zoom}, -${zoom})`}>

                    {/* Grid */}
                    <SceneUnderlay project={project} animatedParts={animatedParts} previewSkeleton={motionPreview?.skeleton} />

                    {/* RENDER MECHANISMS */}
                    {activeMechanisms.map(m => {
                        const { p1, p2, j1, j2, aux, effector, isValid } = calculateLinkage(m, angle);
                        const isSelected = m.id === selectedId;
                        const opacity = isSelected ? 1 : 0.6;
                        const color = m.color;
                        const yokeSlotHalfHeight = m.type === 'yoke' ? Math.abs(m.sliderOffset) + m.crankLength + 30 : 0;

                        let rockerAngleDeg = 0;
                        if (m.type === '4bar' || m.type === 'quick-return') {
                            rockerAngleDeg = Math.atan2(j2.y - p2.y, j2.x - p2.x) * 180 / Math.PI;
                        }

                        return (
                            <g key={m.id} opacity={opacity}>
                                {/* Anchor P1 Visualization */}
                                <g transform={`translate(${p1.x}, ${p1.y})`}>
                                    <g transform={`rotate(${crankDeg * (m.speed1 ?? 1)})`}>
                                        <g fill="#5a6cff" stroke="#3742c6" strokeWidth="2">
                                            <GearPath radius={m.crankLength + 10} teeth={14} />
                                        </g>
                                        <circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />
                                    </g>
                                    <circle cx="0" cy="0" r="12" fill="transparent" stroke={isSelected ? "white" : "transparent"} strokeWidth="2" strokeDasharray="2 2" className="cursor-move" />

                                    {isSelected && (m.type === 'piston' || m.type === 'yoke' || m.type === 'quick-return' || m.type === 'cam') && (
                                        <g transform={`rotate(${m.groundAngle || 0})`}>
                                            <line x1="0" y1="0" x2="100" y2="0" stroke={color} strokeWidth="1" strokeDasharray="4 4" />
                                            <circle cx="100" cy="0" r="6" fill="white" stroke={color} strokeWidth="2" className="cursor-grab" />
                                        </g>
                                    )}
                                </g>

                                {(m.type === '4bar' || m.type === 'quick-return') && m.showOutputGear && isValid && (
                                    <g transform={`translate(${p2.x}, ${p2.y}) rotate(${rockerAngleDeg})`}>
                                        <g fill="#5a6cff" stroke="#3742c6" strokeWidth="2">
                                            <GearPath radius={m.outputGearRadius || 40} teeth={12} />
                                        </g>
                                        <circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />
                                    </g>
                                )}

                                <line x1={p1.x} y1={p1.y} x2={j1.x} y2={j1.y} stroke="#3742c6" strokeWidth="4" strokeLinecap="round" />
                                <circle cx={j1.x} cy={j1.y} r={4} fill={color} />

                                {isValid ? (
                                    <>
                                        {m.type === '4bar' && (
                                            <>
                                                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#cbd5e1" strokeWidth="12" strokeLinecap="round" />
                                                <line x1={p2.x} y1={p2.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="8" strokeLinecap="round" />
                                                <path d={`M ${j1.x} ${j1.y} L ${j2.x} ${j2.y} L ${effector.x} ${effector.y} Z`} fill={`${color}20`} stroke={color} strokeWidth="1" />
                                                <line x1={j1.x} y1={j1.y} x2={j2.x} y2={j2.y} stroke={color} strokeWidth="8" strokeLinecap="round" />
                                                <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={j2.x} cy={j2.y} r={6} fill="white" stroke="#334155" strokeWidth="2" className="cursor-grab" />
                                            </>
                                        )}

                                        {m.type === '5bar' && aux && (
                                            <>
                                                <g transform={`translate(${p2.x}, ${p2.y}) rotate(${(crankDeg * (m.speed2 ?? (m.gearRatio || 1))) + ((m.phase ?? 0) * 180 / Math.PI)})`}>
                                                    <g fill="#5a6cff" stroke="#3742c6" strokeWidth="2">
                                                        <GearPath
                                                            radius={m.rockerLength + 10}
                                                            teeth={Math.max(3, Math.round(14 * (m.rockerLength / m.crankLength)))}
                                                        />
                                                    </g>
                                                    <circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />
                                                </g>
                                                <line x1={p2.x} y1={p2.y} x2={aux.x} y2={aux.y} stroke="#3742c6" strokeWidth="4" strokeLinecap="round" />
                                                <circle cx={aux.x} cy={aux.y} r={4} fill={color} className="cursor-grab" />

                                                {isSelected && (
                                                    <circle cx={aux.x} cy={aux.y} r={8} fill="transparent" stroke="white" strokeWidth="2" strokeDasharray="2,2" className="cursor-grab" />
                                                )}

                                                <line x1={j1.x} y1={j1.y} x2={effector.x} y2={effector.y} stroke="#475569" strokeWidth="6" strokeLinecap="round" />
                                                <line x1={aux.x} y1={aux.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="6" strokeLinecap="round" />

                                                <circle cx={p2.x} cy={p2.y} r={8} fill="transparent" stroke="#94a3b8" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={j2.x} cy={j2.y} r={5} fill="white" stroke="#334155" strokeWidth="2" className="cursor-grab" />
                                            </>
                                        )}

                                        {(m.type === 'cam' || m.type === 'gear' || m.type === 'planetary_gear') && (
                                            <>
                                                {aux && <circle cx={aux.x} cy={aux.y} r={m.rockerLength || 20} fill="none" stroke="#5a6cff" strokeWidth="2" strokeDasharray="6 6" />}
                                                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#cbd5e1" strokeWidth="7" strokeLinecap="round" />
                                                <line x1={p2.x} y1={p2.y} x2={j2.x} y2={j2.y} stroke={color} strokeWidth="6" strokeLinecap="round" />
                                                <line x1={j2.x} y1={j2.y} x2={effector.x} y2={effector.y} stroke="#475569" strokeWidth="4" strokeLinecap="round" />
                                                <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" className={m.type === 'gear' ? 'cursor-grab' : ''} opacity={m.type === 'gear' ? 1 : 0.65} />
                                                <circle cx={j2.x} cy={j2.y} r={5} fill="white" stroke="#334155" strokeWidth="2" className={canDragJ2(m) ? 'cursor-grab' : ''} opacity={canDragJ2(m) ? 1 : 0.65} />
                                            </>
                                        )}

                                        {(m.type === 'piston' || m.type === 'yoke' || m.type === 'quick-return') && (
                                            <>
                                                {m.type === 'piston' && (
                                                    <>
                                                        <g transform={`translate(${p1.x}, ${p1.y}) rotate(${m.groundAngle || 0}) translate(0, ${m.sliderOffset})`}>
                                                            <line x1="-1000" y1="12" x2="1000" y2="12" stroke="#94a3b8" strokeWidth="2" opacity={0.5} />
                                                            <line x1="-1000" y1="-12" x2="1000" y2="-12" stroke="#94a3b8" strokeWidth="2" opacity={0.5} />
                                                        </g>
                                                        <path d={`M ${j1.x} ${j1.y} L ${j2.x} ${j2.y} L ${effector.x} ${effector.y} Z`} fill={`${color}20`} stroke={color} strokeWidth="1" />
                                                        <line x1={j1.x} y1={j1.y} x2={j2.x} y2={j2.y} stroke={color} strokeWidth="8" strokeLinecap="round" />
                                                        <rect x={j2.x - 20} y={j2.y - 10} width="40" height="20" fill="#334155" rx="2" transform={`rotate(${m.groundAngle || 0} ${j2.x} ${j2.y})`} />
                                                    </>
                                                )}

                                                {m.type === 'yoke' && (
                                                    <>
                                                        <g transform={`translate(${p1.x}, ${p1.y}) rotate(${m.groundAngle || 0}) translate(0, ${m.sliderOffset})`}>
                                                            <line x1="-1000" y1="0" x2="1000" y2="0" stroke="#cbd5e1" strokeWidth="4" strokeDasharray="8 8" />
                                                        </g>
                                                        <g transform={`translate(${j2.x}, ${j2.y}) rotate(${m.groundAngle || 0})`}>
                                                            <rect x="-40" y="-10" width="80" height="20" fill={color} rx="4" />
                                                            <rect x="-15" y={-yokeSlotHalfHeight} width="30" height={yokeSlotHalfHeight * 2} rx="4" fill="none" stroke={color} strokeWidth="4" />
                                                            <line x1="0" y1={-yokeSlotHalfHeight + 10} x2="0" y2={yokeSlotHalfHeight - 10} stroke="#dfe3ff" strokeWidth="14" strokeLinecap="round" />
                                                        </g>
                                                        <circle cx={j1.x} cy={j1.y} r={7} fill="#3742c6" />
                                                    </>
                                                )}

                                                {m.type === 'quick-return' && (
                                                    <>
                                                        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round" />
                                                        <line x1={j2.x} y1={j2.y} x2={effector.x} y2={effector.y} stroke={color} strokeWidth="4" strokeLinecap="round" />
                                                        <path d={`M ${p2.x} ${p2.y} L ${j2.x} ${j2.y} L ${effector.x} ${effector.y} Z`} fill={`${color}10`} stroke="none" />
                                                        <line x1={p2.x} y1={p2.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="10" strokeLinecap="round" />
                                                        <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" />
                                                        <circle cx={j1.x} cy={j1.y} r={5} fill="white" stroke="#3742c6" strokeWidth="2" />
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {m.type !== 'crank' && (
                                            <circle cx={effector.x} cy={effector.y} r={6 / zoom} fill="#ef4444" stroke="white" strokeWidth={2 / zoom} className={canDragEffector(m) ? 'cursor-grab' : ''} opacity={canDragEffector(m) ? 1 : 0.55} />
                                        )}
                                        {project && m.targetPartId && project.parts[m.targetPartId] && (
                                            <g opacity="0.8">
                                                {(() => {
                                                    const desiredOutput = m.targetPathId && project.paths[m.targetPathId]?.enabled && project.paths[m.targetPathId].points.length > 1
                                                        ? pointOnProjectPath(project.paths[m.targetPathId], angle)
                                                        : undefined;
                                                    const targetPart = animatedParts[m.targetPartId!] ?? project.parts[m.targetPartId!];
                                                    const anchored = m.targetAnchorJointId ? { ...targetPart, anchorJointId: m.targetAnchorJointId } : targetPart;
                                                    const target = bodyPartPivotScene(anchored, motionPreview?.skeleton ?? project.skeleton);
                                                    return <>
                                                        {desiredOutput && <>
                                                            <line x1={desiredOutput.x} y1={desiredOutput.y} x2={effector.x} y2={effector.y} stroke="#f97316" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom},${5 / zoom}`} opacity="0.8" />
                                                            <circle cx={desiredOutput.x} cy={desiredOutput.y} r={4 / zoom} fill="white" stroke="#f97316" strokeWidth={2 / zoom} />
                                                        </>}
                                                        <line x1={effector.x} y1={effector.y} x2={target.x} y2={target.y} stroke="#ef4444" strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom},${5 / zoom}`} />
                                                        <circle cx={target.x} cy={target.y} r={5 / zoom} fill="#5a6cff" stroke="white" strokeWidth={2 / zoom} />
                                                    </>;
                                                })()}
                                            </g>
                                        )}
                                    </>
                                ) : (
                                    <g transform={`translate(${j1.x + 20}, ${j1.y})`}>
                                        <text x="0" y="0" fill="red" fontSize="10">Invalid</text>
                                    </g>
                                )}

                                {isSelected && isValid && (
                                    <circle cx={j1.x} cy={j1.y} r={8} fill="transparent" stroke="white" strokeWidth="2" strokeDasharray="2,2" />
                                )}
                            </g>
                        );
                    })}

                    {showTrace && Object.entries(traces).filter(([id]) => activeMechanismIds.has(id)).map(([id, trace]: [string, Point[]]) => (
                        trace.length > 1 && (
                            <path
                                key={id}
                                d={`M ${trace.map(p => `${p.x},${p.y}`).join(' L ')}`}
                                fill="none"
                                stroke="white"
                                strokeWidth={3 / zoom}
                                opacity="0.9"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ filter: 'drop-shadow(0px 0px 3px rgba(0,0,0,0.5))' }}
                            />
                        )
                    ))}

                    {userPath.length > 0 && (() => {
                        const bounds = getPathBounds();
                        const PADDING = 10 / zoom;
                        const HANDLE_SIZE = 12 / zoom;

                        return (
                            <g>
                                {/* Main path - clickable, using polyline for open/closed path support */}
                                <polyline
                                    points={userPath.map(p => `${p.x},${p.y}`).join(' ')}
                                    fill="none"
                                    stroke="#5a6cff"
                                    strokeWidth={4 / zoom}
                                    strokeDasharray="8,6"
                                    strokeLinecap="round"
                                    opacity={0.8}
                                    style={{ cursor: isPathSelected ? 'move' : 'pointer' }}
                                    pointerEvents="stroke"
                                    onMouseEnter={() => setIsHoveringPath(true)}
                                    onMouseLeave={() => setIsHoveringPath(false)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsPathSelected(true);
                                    }}
                                    onMouseDown={(e) => {
                                        if (isPathSelected) {
                                            e.stopPropagation();
                                            const p = getWorldPoint(e as any);
                                            if (p) {
                                                setPathDragAction('move');
                                                setPathDragStart(p);
                                            }
                                        }
                                    }}
                                />

                                {/* Selection box and controls */}
                                {isPathSelected && bounds && (
                                    <g>
                                        {/* Selection rectangle - entire area is draggable */}
                                        <rect
                                            x={bounds.minX - PADDING}
                                            y={bounds.minY - PADDING}
                                            width={bounds.maxX - bounds.minX + PADDING * 2}
                                            height={bounds.maxY - bounds.minY + PADDING * 2}
                                            fill="transparent"
                                            stroke="#3b82f6"
                                            strokeWidth={2 / zoom}
                                            strokeDasharray={`${4 / zoom},${4 / zoom}`}
                                            style={{ cursor: 'move' }}
                                            pointerEvents="all"
                                            onMouseDown={(e) => {
                                                e.stopPropagation();
                                                const p = getWorldPoint(e as any);
                                                if (p) {
                                                    setPathDragAction('move');
                                                    setPathDragStart(p);
                                                }
                                            }}
                                        />

                                        {/* Resize handle (bottom-right corner) */}
                                        <g transform={`translate(${bounds.maxX + PADDING}, ${bounds.minY - PADDING}) scale(1, -1)`}>
                                            <rect
                                                x={-HANDLE_SIZE / 2}
                                                y={-HANDLE_SIZE / 2}
                                                width={HANDLE_SIZE}
                                                height={HANDLE_SIZE}
                                                fill="#3b82f6"
                                                stroke="white"
                                                strokeWidth={1 / zoom}
                                                rx={2 / zoom}
                                                style={{ cursor: 'nwse-resize' }}
                                                pointerEvents="fill"
                                                onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                    const p = getWorldPoint(e as any);
                                                    if (p) {
                                                        setPathDragAction('resize');
                                                        setPathDragStart(p);
                                                    }
                                                }}
                                            />
                                        </g>

                                        {/* Delete button (top-left corner) */}
                                        <g transform={`translate(${bounds.minX - PADDING}, ${bounds.maxY + PADDING}) scale(1, -1)`}>
                                            <circle
                                                r={HANDLE_SIZE * 0.8}
                                                fill="#ef4444"
                                                stroke="white"
                                                strokeWidth={1 / zoom}
                                                style={{ cursor: 'pointer' }}
                                                pointerEvents="all"
                                                onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    setUserPath([]);
                                                    setIsPathSelected(false);
                                                }}
                                            />
                                            <text
                                                x={0}
                                                y={HANDLE_SIZE * 0.35}
                                                textAnchor="middle"
                                                fill="white"
                                                fontSize={HANDLE_SIZE}
                                                fontWeight="bold"
                                                pointerEvents="none"
                                            >×</text>
                                        </g>
                                    </g>
                                )}
                            </g>
                        );
                    })()}

                </g>
            </svg>
        </div>
    );
};

const SceneUnderlay = ({ project, animatedParts = {}, previewSkeleton }: { project?: ProjectState; animatedParts?: Record<string, BodyPartLayer>; previewSkeleton?: ProjectState['skeleton'] }) => {
    const kit = project?.settings.physicalKit ?? defaultPhysicalKit();
    const skeleton = previewSkeleton ?? project?.skeleton;
    const sheet = sceneBoundsForSheet(kit);
    const lines = boardGridLines(kit).map(line => <line key={line.key} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke="#e5e8f0" strokeWidth="1" />);
    return <g>
        <rect x={sheet.x} y={sheet.y} width={sheet.width} height={sheet.height} rx="18" fill="#ffffff" stroke="#d6dbe8" strokeWidth="1.5" />
        <g opacity="0.28">{lines}</g>
        <g transform="scale(1,-1)">
            <text x={sheet.x + 16} y={-(sheet.y + sheet.height - 28)} className="fill-slate-400 text-[12px] font-bold" data-testid="scene-grid-label">Letter sheet · {kit.gridPitchMm / 10}cm grid</text>
        </g>
        <line x1={sheet.x} y1="0" x2={sheet.x + sheet.width} y2="0" stroke="#d6dbe8" strokeWidth="1" opacity="0.25" />
        <line x1="0" y1={sheet.y} x2="0" y2={sheet.y + sheet.height} stroke="#d6dbe8" strokeWidth="1" opacity="0.25" />
        {project?.partOrder.map(id => animatedParts[id] ?? project.parts[id]).filter(Boolean).map(part => <React.Fragment key={part.id}><WorldPart part={part} selected={project.selectedPartId === part.id} /></React.Fragment>)}
        {skeleton?.bones.map(([a, b]) => {
            const ja = skeleton?.joints[a];
            const jb = skeleton?.joints[b];
            return ja && jb ? <line key={`${a}-${b}`} x1={ja.position.x} y1={ja.position.y} x2={jb.position.x} y2={jb.position.y} stroke="#334155" strokeWidth="2" opacity="0.35" /> : null;
        })}
        {Object.values(project?.paths ?? {}).filter(p => p.visible).map(path => {
            const d = rawScenePath(path.points, path.closed);
            return d ? <path key={path.id} d={d} fill="none" stroke={path.enabled ? '#5a6cff' : '#94a3b8'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" /> : null;
        })}
    </g>;
};

const WorldPart = ({ part, selected }: { part: BodyPartLayer; selected: boolean }) => {
    if (!part.visible) return null;
    const w = part.bounds.width * part.transform.scale;
    const h = part.bounds.height * part.transform.scale;
    return <g data-testid={`design-part-${part.id}`} transform={`translate(${part.transform.x} ${part.transform.y}) rotate(${part.transform.rotation})`} opacity={part.opacity}>
        <g transform="scale(1,-1)">
            {part.textureUrl ? <image href={part.textureUrl} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity="0.58" /> : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="20" fill={part.fillColor} opacity="0.42" />}
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="20" fill="none" stroke={selected ? '#5a6cff' : part.fillColor} strokeWidth={selected ? 4 : 1.5} strokeDasharray={selected ? undefined : '5 5'} />
        </g>
        {part.localPivotOffset && <circle cx={part.localPivotOffset.x * part.transform.scale} cy={part.localPivotOffset.y * part.transform.scale} r="5" fill="#5a6cff" stroke="white" strokeWidth="2" />}
    </g>;
};

const rawScenePath = (points: Point[], close = false) => {
    if (!points.length) return '';
    return `M ${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}${close ? ' Z' : ''}`;
};
