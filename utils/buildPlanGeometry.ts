import type { FabricationRecipe, MechanismConfig, PhysicalKitSettings, Point, ProjectState } from '../types';
import { SCENE_PX_PER_MM, sceneToBoardRaw } from './coordinates';
import { fabricationGearProfileForPitchRadius } from './fabricationProfiles';
import { calculateLinkage, gearTrainCenters, gearTrainPitchRadii } from './kinematics';
import { motionPathsInProjectOrder } from './motion';
import { pathOwnerLabel } from './pathTargets';
import type {
    BuildPlanGeometryLinkV1,
    BuildPlanGeometryOutlineV1,
    BuildPlanMechanismGeometryV1,
    BuildPlanMechanismV1,
    BuildPlanMotionPathV1
} from './buildPlanTypes';

const round = (value: number) => Number(value.toFixed(4));
const toMm = (point: Point): Point => ({ x: round(point.x / SCENE_PX_PER_MM), y: round(point.y / SCENE_PX_PER_MM) });
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const geometryPoint = (point: { xMm: number; yMm: number }): Point => ({ x: point.xMm, y: point.yMm });

const fnv1a32 = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const capsuleOutline = (a: Point, b: Point, widthMm: number): Point[] => {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const radius = widthMm / 2;
    const points: Point[] = [];
    for (let index = 0; index <= 8; index += 1) {
        const theta = angle + Math.PI / 2 + (Math.PI * index) / 8;
        points.push({ x: round(a.x + Math.cos(theta) * radius), y: round(a.y + Math.sin(theta) * radius) });
    }
    for (let index = 0; index <= 8; index += 1) {
        const theta = angle - Math.PI / 2 + (Math.PI * index) / 8;
        points.push({ x: round(b.x + Math.cos(theta) * radius), y: round(b.y + Math.sin(theta) * radius) });
    }
    return points;
};

const rectangularOutline = (center: Point, widthMm: number, heightMm: number, angleRad = 0): Point[] => [
    { x: -widthMm / 2, y: -heightMm / 2 },
    { x: widthMm / 2, y: -heightMm / 2 },
    { x: widthMm / 2, y: heightMm / 2 },
    { x: -widthMm / 2, y: heightMm / 2 }
].map(point => ({
    x: round(center.x + point.x * Math.cos(angleRad) - point.y * Math.sin(angleRad)),
    y: round(center.y + point.x * Math.sin(angleRad) + point.y * Math.cos(angleRad))
}));

const validStateFor = (mechanism: MechanismConfig) => {
    for (let index = 0; index < 96; index += 1) {
        const phase = (index / 96) * Math.PI * 2;
        const state = calculateLinkage(mechanism, phase);
        if (state.isValid) return { state, phase };
    }
    return { state: calculateLinkage(mechanism, 0), phase: 0 };
};

const geometryBounds = (points: Point[], kit: PhysicalKitSettings) => {
    const half = kit.boardCells * kit.gridPitchMm / 2;
    const xs = [-half, half, ...points.map(point => point.x)];
    const ys = [-half, half, ...points.map(point => point.y)];
    return { minX: round(Math.min(...xs)), minY: round(Math.min(...ys)), maxX: round(Math.max(...xs)), maxY: round(Math.max(...ys)) };
};

export const buildMechanismGeometryV1 = (
    mechanism: MechanismConfig | undefined,
    recipe: FabricationRecipe,
    kit: PhysicalKitSettings,
    partRefs: string[]
): BuildPlanMechanismGeometryV1 => {
    const motionPathIds = [...new Set([recipe.targetPathId, ...recipe.outputBindings.map(binding => binding.pathId)].filter((id): id is string => Boolean(id)))];
    if (!mechanism) {
        const anchor = { x: round(recipe.board.xMm), y: round(recipe.board.yMm) };
        const boundsMm = geometryBounds([anchor], kit);
        return {
            units: 'mm',
            phaseRad: 0,
            points: [{ id: `${recipe.mechanismId}:A`, label: 'A', role: 'fixed-pivot', xMm: anchor.x, yMm: anchor.y, boardCoordinate: recipe.boardCoordinate }],
            links: [],
            outlines: [],
            partRefs,
            motionPathIds,
            boundsMm,
            signature: `fnv1a32:${fnv1a32(JSON.stringify({ recipe, anchor, partRefs }))}`
        };
    }

    const { state, phase } = validStateFor(mechanism);
    const sourcePoints: Array<{ key: string; label: string; role: BuildPlanMechanismGeometryV1['points'][number]['role']; point?: Point }> = [
        { key: 'A', label: 'A', role: 'fixed-pivot', point: state.p1 },
        { key: 'B', label: 'B', role: 'moving-pivot', point: state.j1 },
        { key: 'C', label: 'C', role: 'moving-pivot', point: state.j2 },
        { key: 'D', label: 'D', role: 'fixed-pivot', point: state.p2 },
        { key: 'E', label: 'E', role: 'moving-pivot', point: state.aux },
        { key: 'OUT', label: 'OUT', role: 'output', point: state.effector }
    ];
    const points = sourcePoints.flatMap(item => {
        if (!item.point || !Number.isFinite(item.point.x) || !Number.isFinite(item.point.y)) return [];
        const mm = toMm(item.point);
        const board = sceneToBoardRaw(item.point, kit);
        return [{ id: `${mechanism.id}:${item.key}`, label: item.label, role: item.role, xMm: mm.x, yMm: mm.y, boardCoordinate: board.valid ? board.label : undefined }];
    });
    const pointByLabel = new Map(points.map(point => [point.label, point]));
    const widthMm = Math.max(10, kit.holeDiameterMm + 6);
    const pairSpecs: Array<[string, string, string]> = mechanism.type === 'gear'
        ? []
        : mechanism.type === 'rack-pinion' || mechanism.type === 'cam'
            ? [['D', 'OUT', 'Follower']]
            : [['A', 'B', 'Input link'], ['B', 'C', 'Coupler'], ['D', 'C', 'Output link']];
    if (pointByLabel.has('E')) pairSpecs.splice(2, 0, ['C', 'E', 'Auxiliary link']);
    const links: BuildPlanGeometryLinkV1[] = pairSpecs.flatMap(([fromLabel, toLabel, label], index) => {
        const from = pointByLabel.get(fromLabel);
        const to = pointByLabel.get(toLabel);
        if (!from || !to || distance(geometryPoint(from), geometryPoint(to)) < 0.01) return [];
        return [{ id: `${mechanism.id}:link:${index + 1}`, label, fromPointId: from.id, toPointId: to.id, lengthMm: round(distance(geometryPoint(from), geometryPoint(to))), widthMm, partRef: partRefs[index] }];
    });
    const outlines: BuildPlanGeometryOutlineV1[] = links.map(link => {
        const from = points.find(point => point.id === link.fromPointId)!;
        const to = points.find(point => point.id === link.toPointId)!;
        return { id: `${link.id}:outline`, label: link.label, kind: 'link', closed: true, pointsMm: capsuleOutline(geometryPoint(from), geometryPoint(to), link.widthMm), partRef: link.partRef };
    });

    if (mechanism.type === 'gear' || mechanism.type === 'gear_linkage' || mechanism.type === 'planetary_gear') {
        const centers = gearTrainCenters(mechanism);
        const radii = gearTrainPitchRadii(mechanism);
        centers.forEach((centerScene, index) => {
            const center = toMm(centerScene);
            const pitchRadiusMm = Math.max(1, radii[index] / SCENE_PX_PER_MM);
            const profile = fabricationGearProfileForPitchRadius(pitchRadiusMm);
            outlines.push({
                id: `${mechanism.id}:gear:${index + 1}`,
                label: `Gear ${index + 1}`,
                kind: 'gear',
                closed: true,
                pointsMm: profile.outlinePoints.map(point => ({ x: round(center.x + point.x), y: round(center.y + point.y) })),
                partRef: partRefs[links.length + index]
            });
            points.push({ id: `${mechanism.id}:gear-center:${index + 1}`, label: `G${index + 1}`, role: 'gear-center', xMm: center.x, yMm: center.y, boardCoordinate: sceneToBoardRaw(centerScene, kit).label });
        });
    }
    if (mechanism.type === 'cam') {
        const center = pointByLabel.get('A') ?? points[0];
        if (center) {
            const samples = mechanism.camProfileSamples?.length
                ? mechanism.camProfileSamples
                : Array.from({ length: 48 }, (_, index) => mechanism.crankLength * (0.78 + 0.18 * Math.sin((index / 48) * Math.PI * 2)));
            outlines.push({
                id: `${mechanism.id}:cam`, label: 'Cam', kind: 'cam', closed: true,
                pointsMm: samples.map((radius, index) => {
                    const theta = index / samples.length * Math.PI * 2;
                    return { x: round(center.xMm + Math.cos(theta) * radius / SCENE_PX_PER_MM), y: round(center.yMm + Math.sin(theta) * radius / SCENE_PX_PER_MM) };
                }),
                partRef: partRefs[0]
            });
        }
    }
    if (mechanism.type === 'rack-pinion') {
        const center = pointByLabel.get('D') ?? pointByLabel.get('C');
        if (center) outlines.push({
            id: `${mechanism.id}:rack`, label: 'Rack', kind: 'rack', closed: true,
            pointsMm: rectangularOutline(geometryPoint(center), Math.max(30, mechanism.groundLength / SCENE_PX_PER_MM), widthMm, (mechanism.groundAngle ?? 0) * Math.PI / 180),
            partRef: partRefs[0]
        });
    }
    const boundsMm = geometryBounds([...points.map(point => ({ x: point.xMm, y: point.yMm })), ...outlines.flatMap(outline => outline.pointsMm)], kit);
    const signaturePayload = {
        mechanismId: mechanism.id,
        type: mechanism.type,
        phaseRad: round(phase),
        points: points.map(({ id, xMm, yMm }) => ({ id, xMm, yMm })),
        links: links.map(({ id, fromPointId, toPointId, lengthMm, widthMm: width }) => ({ id, fromPointId, toPointId, lengthMm, width })),
        outlines: outlines.map(({ id, kind, pointsMm }) => ({ id, kind, pointsMm })),
        motionPathIds,
        partRefs
    };
    return { units: 'mm', phaseRad: round(phase), points, links, outlines, partRefs, motionPathIds, boundsMm, signature: `fnv1a32:${fnv1a32(JSON.stringify(signaturePayload))}` };
};

export const buildPlanMotionPathsV1 = (
    project: ProjectState,
    mechanisms: readonly BuildPlanMechanismV1[]
): BuildPlanMotionPathV1[] => motionPathsInProjectOrder(project).map(path => {
    const matching = mechanisms.flatMap(mechanism => {
        const bindings = mechanism.recipe.outputBindings.filter(binding => binding.pathId === path.id);
        return mechanism.recipe.targetPathId === path.id || bindings.length
            ? [{ mechanismRef: mechanism.ref, bindingIds: bindings.map(binding => binding.bindingId) }]
            : [];
    });
    return {
        id: path.id,
        ref: `motion:${encodeURIComponent(path.id)}`,
        label: pathOwnerLabel(project, path),
        targetKind: path.sceneObjectId ? 'scene-object' : 'part',
        targetId: path.sceneObjectId ?? path.partId,
        targetAnchorJointId: path.targetAnchorJointId,
        durationMs: path.duration,
        closed: path.closed,
        enabled: path.enabled,
        visible: path.visible,
        pointsMm: path.points.map(toMm),
        mechanismRefs: matching.map(item => item.mechanismRef),
        bindingIds: matching.flatMap(item => item.bindingIds)
    };
});
