
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BodyPartLayer, CanvasViewport, GlobalConfig, MechanismConfig, Point, ProjectState } from '../types';
import { calculateLinkage, generateCurvePoints, gearTrainCenters, gearTrainPitchRadii, planetaryCarrierOutputRatio, planetaryPlanetSpinRatio, sampledCamProfileScale } from '../utils/kinematics';
import { boardGridLines, boardToScene, bodyPartPivotScene, defaultPhysicalKit, pathFromPoints, SCENE_PX_PER_MM, SCENE_VIEW, sceneBoundsForSheet, sceneToBoard, sceneToSvg } from '../utils/coordinates';
import { motionPreviewForProject, pointOnProjectPath } from '../utils/motion';
import { mechanismWithGeneratedPath } from '../utils/project';
import { clampCanvasZoom } from '../utils/viewport';
import { formatGridLabel } from '../utils/units';
import { ThreePuppetPreview } from './ThreePuppetPreview';
import { fabricationGearPathD, fabricationRingGearPathD, planetaryPlanetCenters, planetaryRingPitchRadius } from '../utils/fabrication';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints, partOutlinePathD, pointInsideOutline } from '../utils/partGeometry';
import { mechanismFeature, type MechanismDragHandle } from '../utils/mechanismFeatureRegistry';
import { normalizeMechanismToReference, referenceRecipeForType } from '../utils/mechanismReference';

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

const GearPath = ({ radius }: { radius: number }) => <path d={fabricationGearPathD(radius, radius / SCENE_PX_PER_MM)} fillRule="evenodd" />;
const RingGearPath = ({ radius }: { radius: number }) => <path d={fabricationRingGearPathD(radius)} fillRule="evenodd" />;
const CamProfilePath = ({ radius, samples }: { radius: number; samples?: number[] }) => {
    const points = Array.from({ length: 48 }, (_, index) => {
        const a = (index / 48) * Math.PI * 2;
        const r = Math.max(1, radius) * sampledCamProfileScale(a, samples);
        return `${Math.cos(a) * r} ${Math.sin(a) * r}`;
    });
    return <path d={`M ${points.join(' L ')} Z`} />;
};

const referenceTopologySummary = (type: MechanismConfig['type']) => {
    if (type === '4bar') return 'A-B input; B-C coupler; C-D output; D-A board-ground';
    if (type === 'gear') return 'fixed gear centers only; no rods; external mesh sequence';
    if (type === 'gear_linkage') return 'fixed gear centers; driven gear handle P; P-R L4 linkage; R bracket';
    if (type === 'cam') return 'rotating cam profile; guided follower block; no linkage rods';
    if (type === 'planetary_gear') return 'fixed ring; sun input; planet on carrier; carrier output';
    if (type === '5bar') return 'A-B-C-D-E closed chain; A-E board-ground; simulation-only';
    if (type === '6bar') return 'A-B-C-D four-bar plus C-E-D dyad; simulation-only';
    if (type === 'piston') return 'crank-slider guide; slider-crank fabrication recipe';
    return `${type} simulation topology`;
};

const referenceCoordRoleSummary = (type: MechanismConfig['type']) => referenceRecipeForType(type)
    .assemblySteps
    .flatMap(step => step.coords.map((coord, index) => `${coord}:${step.coordRoles[index] ?? 'moving_reference'}`))
    .join('|');

const hasNoCrankDriverInCanvas = (type: MechanismConfig['type']) =>
    type === 'gear' || type === 'gear_linkage' || type === 'cam' || type === 'planetary_gear';

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

    const activeMechanisms = useMemo(() => config.mechanisms.filter(m => m.visible && m.enabled !== false), [config.mechanisms]);
    const activeMechanismIds = useMemo(() => new Set(activeMechanisms.map(m => m.id)), [activeMechanisms]);
    const mechanismInteractionPolicies = useMemo(
        () => new Map(activeMechanisms.map(m => [m.id, mechanismFeature(m.type).interactionPolicy(m)])),
        [activeMechanisms]
    );
    const canDragHandle = (m: MechanismConfig, handle: MechanismDragHandle) =>
        mechanismInteractionPolicies.get(m.id)?.draggableHandles.includes(handle) ?? mechanismFeature(m.type).interactionPolicy(m).draggableHandles.includes(handle);
    const canDragJ2 = (m: MechanismConfig) => canDragHandle(m, 'J2');
    const canDragP2 = (m: MechanismConfig) => canDragHandle(m, 'P2');
    const canDragEffector = (m: MechanismConfig) => canDragHandle(m, 'Effector');
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
            // Generate full static traces once when paused. During playback, traces are derived from angle below
            // instead of appended through React state on every animation frame.
            const newTraces: Record<string, Point[]> = {};
            activeMechanisms.forEach(m => {
                if (m.type !== 'crank') {
                    newTraces[m.id] = generateCurvePoints(m, 100).points;
                }
            });
            setTraces(newTraces);
        } else {
            setTraces(prev => Object.keys(prev).length ? {} : prev);
        }
    }, [activeMechanisms, isPlaying]);

    const displayedTraces = useMemo(() => {
        if (!isPlaying || isDrawMode || !showTrace) return traces;
        const result: Record<string, Point[]> = {};
        const progress = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const ratio = Math.max(0.04, progress / (Math.PI * 2));
        const samples = Math.max(4, Math.round(80 * ratio));
        activeMechanisms.forEach(m => {
            if (m.type === 'crank') return;
            const points: Point[] = [];
            for (let i = 0; i <= samples; i += 1) {
                const state = calculateLinkage(m, (progress * i) / samples);
                if (state.isValid) points.push(state.effector);
            }
            result[m.id] = points;
        });
        return result;
    }, [activeMechanisms, angle, isDrawMode, isPlaying, showTrace, traces]);

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

    const snapAnchorUpdates = (m: MechanismConfig, updates: Partial<MechanismConfig>) => {
        if (updates.anchorX === undefined || updates.anchorY === undefined) return updates;
        const kit = project?.settings.physicalKit ?? defaultPhysicalKit();
        const board = sceneToBoard({ x: updates.anchorX, y: updates.anchorY }, kit);
        const anchor = boardToScene(board.col, board.row, kit);
        return {
            ...updates,
            anchorX: anchor.x,
            anchorY: anchor.y,
            sceneAnchor: anchor,
            transform: { ...(m.transform ?? { x: anchor.x, y: anchor.y, rotation: m.groundAngle ?? 0, scale: 1 }), ...(updates.transform ?? {}), x: anchor.x, y: anchor.y }
        };
    };

    const updateMechanism = (id: string, updates: Partial<MechanismConfig>) => {
        setConfig(prev => ({
            ...prev,
            mechanisms: prev.mechanisms.map(m => {
                if (m.id !== id) return m;
                const next = { ...m, ...snapAnchorUpdates(m, updates) };
                const normalized = next.type === 'gear' || next.type === 'gear_linkage' || next.type === 'planetary_gear'
                    ? normalizeMechanismToReference(next)
                    : next;
                return mechanismWithGeneratedPath(normalized);
            })
        }));
    };

    useEffect(() => {
        if (dragTarget && (!activeMechanisms.some(m => m.id === dragTarget.mechId) || selectedId !== dragTarget.mechId)) setDragTarget(null);
    }, [config.mechanisms, selectedId, dragTarget]);

    const handleWheel = (e: React.WheelEvent) => {
        if (!svgRef.current) return;
        e.stopPropagation();

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
                if (canDragHandle(m, 'Aux') && state.aux && dist(p, state.aux) < HIT_RADIUS) {
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
                if (canDragHandle(m, 'J1') && dist(p, state.j1) < HIT_RADIUS) {
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
                if (canDragHandle(m, 'P1') && dist(p, state.p1) < HIT_RADIUS * 1.5) {
                    setDragTarget({ mechId: m.id, type: 'P1' });
                    setSelectedId(m.id);
                    return;
                }
            }
        }

        if (!isDrawMode && 'button' in e && (e as React.MouseEvent).button === 0) {
            setIsPanning(true);
            e.preventDefault();
            return;
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

                if (m.type === '4bar' || m.type === '5bar' || m.type === '6bar' || m.type === 'gear' || m.type === 'gear_linkage') {
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
                if (m.type === '6bar') {
                    updateMechanism(m.id, { rodLength: dist(state.j2, p), couplerPointDist: dist(state.p2, p) });
                } else {
                    const newRadius = dist(state.p2, p);
                    updateMechanism(m.id, { rockerLength: newRadius });
                }
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
                } else if (m.type === '6bar') {
                    const newCoupler = dist(state.j1, p);
                    const newRocker = dist(state.p2, p);
                    const newDyad = state.aux ? dist(state.aux, p) : (m.rodLength ?? 95);
                    updateMechanism(m.id, { couplerLength: newCoupler, rockerLength: newRocker, rodLength: newDyad });
                } else if (m.type === 'quick-return' || m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') {
                    updateMechanism(m.id, { rockerLength: dist(state.p2, p) });
                }
            }
            else if (dragTarget.type === 'Effector') {
                if (canDragEffector(m)) {
                    if (m.type === '5bar') {
                        const newExtension = dist(state.j2, p);
                        updateMechanism(m.id, { couplerPointDist: newExtension });
                    } else if (m.type === '6bar') {
                        updateMechanism(m.id, { rodLength: dist(state.j2, p), couplerPointDist: dist(state.p2, p) });
                    } else if (m.type === 'gear' || m.type === 'gear_linkage' || m.type === 'planetary_gear') {
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
            className={`canvas-surface w-full h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative select-none ${isDrawMode ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}
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
                        const recipe = referenceRecipeForType(m.type);
                        const coordRoleSummary = referenceCoordRoleSummary(m.type);
                        const gearCenters = (m.type === 'gear' || m.type === 'gear_linkage') ? gearTrainCenters(m) : [];
                        const gearRadii = (m.type === 'gear' || m.type === 'gear_linkage') ? gearTrainPitchRadii(m) : [];
                        const showCrankDriver = !hasNoCrankDriverInCanvas(m.type);

                        let rockerAngleDeg = 0;
                        if (m.type === '4bar' || m.type === 'quick-return') {
                            rockerAngleDeg = Math.atan2(j2.y - p2.y, j2.x - p2.x) * 180 / Math.PI;
                        }

                        return (
                            <g
                                key={m.id}
                                opacity={opacity}
                                data-testid={`design-mechanism-${m.id}`}
                                data-mechanism-type={m.type}
                                data-reference-canonical-key={recipe.canonicalKey}
                                data-reference-topology={referenceTopologySummary(m.type)}
                                data-reference-stack-labels={recipe.stackLabels.join(' → ')}
                                data-reference-coord-roles={coordRoleSummary}
                                data-reference-export-ready={recipe.exportReady ? 'true' : 'false'}
                                data-reference-support={recipe.support}
                            >
                                {/* Anchor P1 Visualization: only the actual driver family gets a crank bar. */}
                                <g transform={`translate(${p1.x}, ${p1.y})`}>
                                    <g transform={`rotate(${crankDeg * (m.speed1 ?? 1)})`}>
                                        <g fill="#5a6cff" stroke="#3742c6" strokeWidth="2">
                                            {m.type === 'cam'
                                                ? <CamProfilePath radius={m.crankLength} samples={m.camProfileSamples} />
                                                : m.type === 'planetary_gear'
                                                    ? <GearPath radius={m.crankLength} />
                                                    : showCrankDriver
                                                        ? <line x1="0" y1="0" x2={m.crankLength} y2="0" stroke="#3742c6" strokeWidth="8" strokeLinecap="round" />
                                                        : null}
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

                                {(m.type === 'gear' || m.type === 'gear_linkage') && gearCenters.map((center, index) => {
                                    const ratio = index === 0 ? 1 : (index % 2 === 1 ? -1 : 1) * (gearRadii[0] ?? 1) / (gearRadii[index] ?? 1);
                                    return <g key={`${m.id}-gear-${index}`} transform={`translate(${center.x}, ${center.y}) rotate(${crankDeg * ratio})`}>
                                        <g fill={index === 0 ? '#5a6cff' : '#94a3b8'} stroke={index === 0 ? '#3742c6' : '#475569'} strokeWidth="2">
                                            <GearPath radius={gearRadii[index] ?? m.crankLength} />
                                        </g>
                                        <circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />
                                    </g>;
                                })}

                                {(m.type === '4bar' || m.type === 'quick-return') && m.showOutputGear && isValid && (
                                    <g transform={`translate(${p2.x}, ${p2.y}) rotate(${rockerAngleDeg})`}>
                                        <g fill="#5a6cff" stroke="#3742c6" strokeWidth="2">
                                            <GearPath radius={m.outputGearRadius || 40} />
                                        </g>
                                        <circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />
                                    </g>
                                )}

                                {showCrankDriver && <>
                                    <line x1={p1.x} y1={p1.y} x2={j1.x} y2={j1.y} stroke="#3742c6" strokeWidth="4" strokeLinecap="round" />
                                    <circle cx={j1.x} cy={j1.y} r={4} fill={color} />
                                </>}

                                {isValid ? (
                                    <>
                                        {m.type === '4bar' && (
                                            <>
                                                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#cbd5e1" strokeWidth="12" strokeLinecap="round" />
                                                <line x1={p2.x} y1={p2.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="8" strokeLinecap="round" />
                                                <line x1={j1.x} y1={j1.y} x2={j2.x} y2={j2.y} stroke={color} strokeWidth="8" strokeLinecap="round" />
                                                <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={j2.x} cy={j2.y} r={6} fill="white" stroke="#334155" strokeWidth="2" className="cursor-grab" />
                                            </>
                                        )}

                                        {m.type === '5bar' && aux && (
                                            <>
                                                <line x1={p2.x} y1={p2.y} x2={aux.x} y2={aux.y} stroke="#3742c6" strokeWidth="4" strokeLinecap="round" />
                                                <circle cx={aux.x} cy={aux.y} r={4} fill={color} className="cursor-grab" />

                                                {isSelected && (
                                                    <circle cx={aux.x} cy={aux.y} r={8} fill="transparent" stroke="white" strokeWidth="2" strokeDasharray="2,2" className="cursor-grab" />
                                                )}

                                                <line x1={j1.x} y1={j1.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="6" strokeLinecap="round" />
                                                <line x1={aux.x} y1={aux.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="6" strokeLinecap="round" />
                                                <line x1={j2.x} y1={j2.y} x2={effector.x} y2={effector.y} stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.75" />

                                                <circle cx={p2.x} cy={p2.y} r={8} fill="transparent" stroke="#94a3b8" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={j2.x} cy={j2.y} r={5} fill="white" stroke="#334155" strokeWidth="2" className="cursor-grab" />
                                            </>
                                        )}

                                        {m.type === '6bar' && aux && (
                                            <>
                                                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#cbd5e1" strokeWidth="12" strokeLinecap="round" />
                                                <line x1={p2.x} y1={p2.y} x2={j2.x} y2={j2.y} stroke="#475569" strokeWidth="8" strokeLinecap="round" />
                                                <line x1={j1.x} y1={j1.y} x2={j2.x} y2={j2.y} stroke={color} strokeWidth="8" strokeLinecap="round" />
                                                <line x1={j2.x} y1={j2.y} x2={aux.x} y2={aux.y} stroke="#64748b" strokeWidth="6" strokeLinecap="round" />
                                                <line x1={p2.x} y1={p2.y} x2={aux.x} y2={aux.y} stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" />
                                                <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={j2.x} cy={j2.y} r={6} fill="white" stroke="#334155" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={aux.x} cy={aux.y} r={5} fill="white" stroke={color} strokeWidth="2" className="cursor-grab" />
                                            </>
                                        )}

                                        {m.type === 'gear' && (
                                            <>
                                                {gearCenters.slice(1).map((center, index) => {
                                                    const previous = gearCenters[index];
                                                    return previous ? <line key={`${m.id}-gear-mesh-${index}`} x1={previous.x} y1={previous.y} x2={center.x} y2={center.y} stroke="#94a3b8" strokeWidth="2" strokeDasharray="7 7" opacity="0.55" /> : null;
                                                })}
                                                <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" className="cursor-grab" />
                                                <circle cx={j2.x} cy={j2.y} r={5} fill="white" stroke="#334155" strokeWidth="2" opacity="0.65" />
                                            </>
                                        )}

                                        {m.type === 'gear_linkage' && (
                                            <>
                                                <line x1={p2.x} y1={p2.y} x2={j2.x} y2={j2.y} stroke="#94a3b8" strokeWidth="5" strokeLinecap="round" />
                                                <line x1={j2.x} y1={j2.y} x2={effector.x} y2={effector.y} stroke={color} strokeWidth="8" strokeLinecap="round" />
                                                <g transform={`translate(${effector.x}, ${effector.y}) rotate(${Math.atan2(effector.y - j2.y, effector.x - j2.x) * 180 / Math.PI})`}>
                                                    <rect x="-12" y="-7" width="24" height="14" rx="5" fill="#e2e8f0" stroke="#475569" strokeWidth="2" />
                                                    <circle cx="-6" cy="0" r="3" fill="white" stroke="#475569" strokeWidth="1.5" />
                                                    <circle cx="6" cy="0" r="3" fill="white" stroke="#475569" strokeWidth="1.5" />
                                                </g>
                                                <circle cx={p2.x} cy={p2.y} r={8} fill="#94a3b8" stroke="white" strokeWidth="2" opacity={0.65} />
                                                <circle cx={j2.x} cy={j2.y} r={5} fill="white" stroke="#334155" strokeWidth="2" opacity={0.65} />
                                            </>
                                        )}

                                        {m.type === 'cam' && (
                                            <>
                                                {(() => {
                                                    const a = ((m.groundAngle ?? 90) * Math.PI) / 180;
                                                    const axis = { x: Math.cos(a), y: Math.sin(a) };
                                                    const normal = { x: -Math.sin(a), y: Math.cos(a) };
                                                    const railA = { x: j2.x - axis.x * 90, y: j2.y - axis.y * 90 };
                                                    const railB = { x: j2.x + axis.x * 90, y: j2.y + axis.y * 90 };
                                                    return <>
                                                        <line x1={railA.x + normal.x * 12} y1={railA.y + normal.y * 12} x2={railB.x + normal.x * 12} y2={railB.y + normal.y * 12} stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
                                                        <line x1={railA.x - normal.x * 12} y1={railA.y - normal.y * 12} x2={railB.x - normal.x * 12} y2={railB.y - normal.y * 12} stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
                                                        <line x1={p1.x} y1={p1.y} x2={j1.x} y2={j1.y} stroke={color} strokeWidth="2" strokeDasharray="6 6" opacity="0.7" />
                                                        <g transform={`translate(${j2.x}, ${j2.y}) rotate(${m.groundAngle ?? 90})`}>
                                                            <rect x="-24" y="-12" width="48" height="24" rx="8" fill="#e2e8f0" stroke="#475569" strokeWidth="2" />
                                                            <circle cx="0" cy="0" r="5" fill="white" stroke="#334155" strokeWidth="2" />
                                                        </g>
                                                    </>;
                                                })()}
                                            </>
                                        )}

                                        {m.type === 'planetary_gear' && (
                                            <>
                                                {(() => {
                                                    const ringRadius = planetaryRingPitchRadius(m);
                                                    const carrierAngle = angle * planetaryCarrierOutputRatio(m.crankLength, m.rockerLength);
                                                    const planetCenters = planetaryPlanetCenters(p1, m, carrierAngle);
                                                    const planetCount = Math.max(1, planetCenters.length);
                                                    return <>
                                                        <g transform={`translate(${p1.x}, ${p1.y})`}>
                                                            <g fill="#c4b5fd" stroke="#6d5dfc" strokeWidth="2" opacity="0.75">
                                                                <RingGearPath radius={ringRadius} />
                                                            </g>
                                                        </g>
                                                        {planetCenters.map((center, index) => (
                                                            <g key={`${m.id}-planet-${index}`} transform={`translate(${center.x}, ${center.y}) rotate(${crankDeg * planetaryPlanetSpinRatio(m.crankLength, m.rockerLength) + index * (360 / planetCount)})`}>
                                                                <line x1={p1.x - center.x} y1={p1.y - center.y} x2="0" y2="0" stroke="#475569" strokeWidth="5" strokeLinecap="round" />
                                                                <g fill="#94a3b8" stroke="#475569" strokeWidth="2">
                                                                    <GearPath radius={m.rockerLength} />
                                                                </g>
                                                                <circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />
                                                            </g>
                                                        ))}
                                                    </>;
                                                })()}
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
                                            <circle data-testid={`mechanism-effector-${m.id}`} cx={effector.x} cy={effector.y} r={6 / zoom} fill="#ef4444" stroke="white" strokeWidth={2 / zoom} className={canDragEffector(m) ? 'cursor-grab' : ''} opacity={canDragEffector(m) ? 1 : 0.55} />
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
                                                        <circle data-testid={`mechanism-target-${m.id}`} cx={target.x} cy={target.y} r={5 / zoom} fill="#5a6cff" stroke="white" strokeWidth={2 / zoom} />
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
                                {isSelected && canDragHandle(m, 'P1') && (
                                    <circle data-testid={`mechanism-anchor-${m.id}`} cx={p1.x} cy={p1.y} r={14 / zoom} fill="transparent" stroke="white" strokeWidth={2 / zoom} strokeDasharray={`${3 / zoom},${3 / zoom}`} className="cursor-move" pointerEvents="all" />
                                )}
                            </g>
                        );
                    })}

                    {showTrace && Object.entries(displayedTraces).filter(([id]) => activeMechanismIds.has(id)).map(([id, trace]: [string, Point[]]) => (
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
            {project && <ThreePuppetPreview
                project={project}
                animatedParts={animatedParts}
                skeleton={motionPreview?.skeleton ?? project.skeleton}
                mechanisms={activeMechanisms}
                angle={angle}
                viewport={activeViewport}
                setViewport={writeViewport}
                inputMode="3d-only"
                testId="design-three-puppet"
            />}
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
            <text x={sheet.x + 16} y={-(sheet.y + sheet.height - 28)} className="fill-slate-400 text-[12px] font-bold" data-testid="scene-grid-label">{formatGridLabel(kit, project?.settings.gridUnit ?? 'cm')}</text>
        </g>
        {project?.settings.debugVisuals && <g data-testid="canvas-debug-visuals" pointerEvents="none" transform="scale(1,-1)">
            <rect x={sheet.x + sheet.width - 182} y={-(sheet.y + sheet.height - 94)} width="166" height="76" rx="12" fill="#0f172a" opacity="0.78"/>
            <text x={sheet.x + sheet.width - 166} y={-(sheet.y + sheet.height - 68)} fill="white" fontSize="12" fontWeight="800">Debug visuals</text>
            <text x={sheet.x + sheet.width - 166} y={-(sheet.y + sheet.height - 48)} fill="#cbd5e1" fontSize="11">{project.partOrder.length} parts · {Object.keys(skeleton?.joints ?? {}).length} joints</text>
            <text x={sheet.x + sheet.width - 166} y={-(sheet.y + sheet.height - 30)} fill="#cbd5e1" fontSize="11">snap {project.settings.physicsSnapMode} · fab {project.settings.fabricationReadyMode ? 'on' : 'off'}</text>
        </g>}
        <line x1={sheet.x} y1="0" x2={sheet.x + sheet.width} y2="0" stroke="#d6dbe8" strokeWidth="1" opacity="0.25" />
        <line x1="0" y1={sheet.y} x2="0" y2={sheet.y + sheet.height} stroke="#d6dbe8" strokeWidth="1" opacity="0.25" />
        {project?.partOrder.map(id => animatedParts[id] ?? project.parts[id]).filter(Boolean).map(part => <React.Fragment key={part.id}><WorldPart part={part} skeleton={skeleton} selected={project.selectedPartId === part.id} /></React.Fragment>)}
        {skeleton?.bones.map(([a, b]) => {
            const ja = skeleton?.joints[a];
            const jb = skeleton?.joints[b];
            return ja && jb ? <line key={`${a}-${b}`} x1={ja.position.x} y1={ja.position.y} x2={jb.position.x} y2={jb.position.y} stroke="#64748b" strokeWidth="2" opacity="0.12" /> : null;
        })}
        {Object.values(skeleton?.joints ?? {}).map(joint => (
            <circle
                key={joint.id}
                data-testid={`skeleton-joint-${joint.id}`}
                cx={joint.position.x}
                cy={joint.position.y}
                r={joint.locked ? 6 : 4.5}
                fill={joint.locked ? '#64748b' : '#94a3b8'}
                stroke="#ffffff"
                strokeWidth="1.8"
                opacity="0.3"
            />
        ))}
        {Object.values(project?.paths ?? {}).filter(p => p.visible).map(path => {
            const d = rawScenePath(path.points, path.closed);
            return d ? <path key={path.id} d={d} fill="none" stroke={path.enabled ? '#5a6cff' : '#94a3b8'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" /> : null;
        })}
    </g>;
};

const WorldPart = ({ part, skeleton, selected }: { part: BodyPartLayer; skeleton?: ProjectState['skeleton']; selected: boolean }) => {
    if (!part.visible) return null;
    const w = part.bounds.width * part.transform.scale;
    const h = part.bounds.height * part.transform.scale;
    const artX = part.bounds.x * part.transform.scale;
    const artY = -(part.bounds.y + part.bounds.height) * part.transform.scale;
    const landmarks = partLandmarkLocalPoints(part, skeleton);
    const outline = fabricablePartOutlinePoints(part, landmarks);
    const outlineD = partOutlinePathD(part, landmarks, { scale: part.transform.scale, flipY: true });
    const localHoles = landmarks.filter(local => pointInsideOutline(local, outline, 0.5));
    const holeRadius = Math.max(5, 7.2 * part.transform.scale);
    const maskId = `design-part-surface-mask-${part.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const stroke = selected ? '#5a6cff' : '#94a3b8';
    return <g data-testid={`design-part-${part.id}`} data-assembly-underlay="plate-art-layer" transform={`translate(${part.transform.x} ${part.transform.y}) rotate(${part.transform.rotation})`} opacity={part.opacity}>
        <g transform="scale(1,-1)">
            <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse">
                    <rect x="-1000" y="-1000" width="2000" height="2000" fill="black" />
                    <path d={outlineD} fill="white" />
                    {localHoles.map((local, index) => <circle key={index} cx={local.x * part.transform.scale} cy={-local.y * part.transform.scale} r={holeRadius} fill="black" />)}
                </mask>
            </defs>
            <rect x={artX} y={artY} width={w} height={h} fill="#eef2f7" opacity="0.72" mask={`url(#${maskId})`} />
            {part.textureUrl ? <image data-testid={`design-part-art-${part.id}`} href={part.textureUrl} x={artX} y={artY} width={w} height={h} preserveAspectRatio="xMidYMid meet" opacity="0.52" mask={`url(#${maskId})`} style={{ filter: 'saturate(0.82) contrast(0.96)' }} /> : <rect data-testid={`design-part-art-${part.id}`} x={artX} y={artY} width={w} height={h} rx="20" fill={part.fillColor} opacity="0.52" mask={`url(#${maskId})`} />}
            <path data-testid={`design-part-plate-${part.id}`} data-art-offset-x={artX} d={outlineD} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 1.2} strokeDasharray={selected ? undefined : '5 5'} opacity={selected ? 0.72 : 0.28} />
        </g>
        {part.localPivotOffset && <circle cx={part.localPivotOffset.x * part.transform.scale} cy={part.localPivotOffset.y * part.transform.scale} r="5" fill="#64748b" stroke="white" strokeWidth="2" />}
    </g>;
};

const rawScenePath = (points: Point[], close = false) => {
    if (!points.length) return '';
    return `M ${points.map(p => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L ')}${close ? ' Z' : ''}`;
};
