import { AppStage, MechanismConfig, Point, ProjectState } from '../types';
import { boardGridLines, sceneBoundsForSheet, SCENE_PX_PER_MM } from './coordinates';
import { calculateLinkage } from './kinematics';
import { mechanismTemplateLabel } from './mechanismTemplates';

export type ProjectionSourceType =
    | 'board'
    | 'part'
    | 'scene-object'
    | 'joint'
    | 'bone'
    | 'path'
    | 'mechanism'
    | 'hardware'
    | 'helper'
    | 'label'
    | 'warning';

export type ProjectionExportRole =
    | 'fabrication'
    | 'project-reference'
    | 'preview-only'
    | 'label'
    | 'debug';

export type ProjectionGeometry =
    | { kind: 'rect'; center: Point; size: { width: number; height: number }; rotationRad: number }
    | { kind: 'circle'; center: Point; radius: number }
    | { kind: 'polyline'; points: Point[]; closed: boolean; width: number }
    | { kind: 'line'; from: Point; to: Point; width: number };

export type ToonMaterial = 'board' | 'paper' | 'acrylic' | 'toyMetal' | 'pin' | 'pathRibbon' | 'ghost' | 'warning';

export interface ToonSceneNode {
    id: string;
    sourceType: ProjectionSourceType;
    sourceId?: string;
    parentId?: string;
    label: string;
    geometry: ProjectionGeometry;
    transform2d: { x: number; y: number; rotationRad: number; scale: number };
    depthMm: number;
    thicknessMm: number;
    renderOrder: number;
    material: ToonMaterial;
    interactive: boolean;
    exportRole: ProjectionExportRole;
}

export interface InteractionBinding {
    id: string;
    type: 'draw-path-on-plane' | 'select-source' | 'pan-zoom-locked-camera' | 'unlock-camera' | 'bake-3d-transform';
    enabled: boolean;
    sourceType?: ProjectionSourceType;
    sourceId?: string;
    nodeId?: string;
    writesProject: boolean;
    reason?: string;
}

export interface ToonLabelNode {
    id: string;
    text: string;
    anchorNodeId?: string;
    anchorPoint: Point;
    severity?: 'info' | 'warning' | 'error';
    collapsible: boolean;
}

export interface CameraPreset {
    id: 'locked-2.5d' | 'depth-inspect' | 'toy-stage' | 'assembly-exploded' | 'inspect-free';
    label: '2.5D Locked' | 'Depth Inspect' | 'Toy Stage' | 'Exploded Assembly' | 'Inspect';
    locked: boolean;
    orbitEnabled: boolean;
    position: { x: number; y: number; zMm: number };
    lookAt: { x: number; y: number; zMm: number };
    zoom: number;
}

export interface ProjectionWarning {
    id: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    sourceNodeId?: string;
    sourceType?: ProjectionSourceType;
    sourceId?: string;
    recoveryStage?: AppStage;
}

export interface ToonSceneProjection {
    version: 1;
    units: { scene: 'px'; depth: 'mm'; scenePxPerMm: number };
    coordinateSystem: { x: 'right'; y: 'up'; z: 'toward-camera-depth' };
    nodes: ToonSceneNode[];
    labels: ToonLabelNode[];
    cameras: CameraPreset[];
    interactions: InteractionBinding[];
    warnings: ProjectionWarning[];
}

const CATEGORY_ORDER: Record<ProjectionSourceType, number> = {
    board: 0,
    part: 10,
    'scene-object': 15,
    bone: 20,
    joint: 21,
    path: 30,
    mechanism: 40,
    hardware: 41,
    helper: 50,
    label: 60,
    warning: 61
};

const pathSegment = (value: string) => value.replace(/[^A-Za-z0-9_.:>-]/g, '_');
const rotationRad = (degrees = 0) => (degrees * Math.PI) / 180;
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clonePoint = (point: Point): Point => ({ x: finite(point.x), y: finite(point.y) });

const transformPoint = (local: Point, transform: { x: number; y: number; rotation: number; scale: number }): Point => {
    const angle = rotationRad(transform.rotation);
    const scale = finite(transform.scale, 1) || 1;
    const x = local.x * scale;
    const y = local.y * scale;
    return {
        x: finite(transform.x + x * Math.cos(angle) - y * Math.sin(angle)),
        y: finite(transform.y + x * Math.sin(angle) + y * Math.cos(angle))
    };
};

const nodeDepth = (sourceType: ProjectionSourceType, baseDepth = 0) => {
    if (sourceType === 'board') return -4;
    if (sourceType === 'scene-object') return baseDepth + 0.5;
    if (sourceType === 'bone' || sourceType === 'joint') return baseDepth + 1;
    if (sourceType === 'path') return baseDepth + 3;
    if (sourceType === 'mechanism' || sourceType === 'hardware') return baseDepth + 5;
    if (sourceType === 'label' || sourceType === 'warning') return baseDepth + 8;
    return baseDepth;
};

const applyRenderOrder = (nodes: ToonSceneNode[]) => {
    const sorted = [...nodes].sort((a, b) =>
        a.depthMm - b.depthMm ||
        CATEGORY_ORDER[a.sourceType] - CATEGORY_ORDER[b.sourceType] ||
        a.id.localeCompare(b.id)
    );
    return sorted.map((node, index) => ({ ...node, renderOrder: index }));
};

const baseNode = (node: Omit<ToonSceneNode, 'renderOrder'>): ToonSceneNode => ({
    ...node,
    renderOrder: 0,
    transform2d: {
        x: finite(node.transform2d.x),
        y: finite(node.transform2d.y),
        rotationRad: finite(node.transform2d.rotationRad),
        scale: finite(node.transform2d.scale, 1) || 1
    },
    depthMm: finite(node.depthMm),
    thicknessMm: finite(node.thicknessMm)
});

const mechanismAnchor = (mechanism: MechanismConfig): Point => ({
    x: finite(mechanism.anchorX ?? mechanism.sceneAnchor?.x ?? mechanism.transform?.x ?? 0),
    y: finite(mechanism.anchorY ?? mechanism.sceneAnchor?.y ?? mechanism.transform?.y ?? 0)
});

const mechanismNodeDepth = (mechanismIndex: number) => nodeDepth('mechanism', 20 + mechanismIndex * 0.25);

const geometryAnchor = (geometry: ProjectionGeometry): Point => {
    if (geometry.kind === 'rect' || geometry.kind === 'circle') return clonePoint(geometry.center);
    if (geometry.kind === 'line') return { x: (geometry.from.x + geometry.to.x) / 2, y: (geometry.from.y + geometry.to.y) / 2 };
    if (!geometry.points.length) return { x: 0, y: 0 };
    const sum = geometry.points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { x: sum.x / geometry.points.length, y: sum.y / geometry.points.length };
};

export const buildToonSceneProjection = (project: ProjectState): ToonSceneProjection => {
    const nodes: ToonSceneNode[] = [];
    const labels: ToonLabelNode[] = [];
    const warnings: ProjectionWarning[] = [];
    const partDepth = new Map<string, number>();
    const sceneObjectDepth = new Map<string, number>();
    const kit = project.settings.physicalKit;
    const sheet = sceneBoundsForSheet(kit);

    nodes.push(baseNode({
        id: '/board/sheet',
        sourceType: 'board',
        label: `${kit.profileKey} sheet`,
        geometry: {
            kind: 'rect',
            center: { x: sheet.x + sheet.width / 2, y: sheet.y + sheet.height / 2 },
            size: { width: sheet.width, height: sheet.height },
            rotationRad: 0
        },
        transform2d: { x: 0, y: 0, rotationRad: 0, scale: 1 },
        depthMm: nodeDepth('board'),
        thicknessMm: 3,
        material: 'board',
        interactive: false,
        exportRole: 'preview-only'
    }));

    boardGridLines(kit).forEach(line => {
        nodes.push(baseNode({
            id: `/board/grid/${pathSegment(line.key)}`,
            sourceType: 'board',
            label: line.key,
            geometry: { kind: 'line', from: clonePoint(line.a), to: clonePoint(line.b), width: 1 },
            transform2d: { x: 0, y: 0, rotationRad: 0, scale: 1 },
            depthMm: nodeDepth('board') + 0.1,
            thicknessMm: 0.2,
            material: 'acrylic',
            interactive: false,
            exportRole: 'preview-only'
        }));
    });

    project.partOrder.forEach((partId, index) => {
        const part = project.parts[partId];
        if (!part || part.visible === false) return;
        const depth = part.zIndex * 2 + index * 0.01;
        partDepth.set(part.id, depth);
        const localCenter = { x: part.bounds.x + part.bounds.width / 2, y: part.bounds.y + part.bounds.height / 2 };
        const center = transformPoint(localCenter, part.transform);
        nodes.push(baseNode({
            id: `/character/${pathSegment(part.id)}`,
            sourceType: 'part',
            sourceId: part.id,
            label: part.name || part.id,
            geometry: {
                kind: 'rect',
                center,
                size: {
                    width: finite(part.bounds.width * (part.transform.scale || 1)),
                    height: finite(part.bounds.height * (part.transform.scale || 1))
                },
                rotationRad: rotationRad(part.transform.rotation)
            },
            transform2d: {
                x: finite(part.transform.x),
                y: finite(part.transform.y),
                rotationRad: rotationRad(part.transform.rotation),
                scale: finite(part.transform.scale, 1) || 1
            },
            depthMm: depth,
            thicknessMm: 2.4,
            material: 'paper',
            interactive: part.selectable !== false,
            exportRole: 'project-reference'
        }));
    });

    project.sceneObjectOrder.forEach((objectId, index) => {
        const object = project.sceneObjects[objectId];
        if (!object || object.visible === false) return;
        const scale = finite(object.transform.scale, 1) || 1;
        const depth = nodeDepth('scene-object', object.zIndex * 2 + index * 0.01);
        sceneObjectDepth.set(object.id, depth);
        nodes.push(baseNode({
            id: `/scene-objects/${pathSegment(object.id)}`,
            sourceType: 'scene-object',
            sourceId: object.id,
            label: object.name || object.id,
            geometry: {
                kind: 'rect',
                center: { x: finite(object.transform.x), y: finite(object.transform.y) },
                size: {
                    width: finite(object.bounds.width * scale),
                    height: finite(object.bounds.height * scale)
                },
                rotationRad: rotationRad(object.transform.rotation)
            },
            transform2d: {
                x: finite(object.transform.x),
                y: finite(object.transform.y),
                rotationRad: rotationRad(object.transform.rotation),
                scale
            },
            depthMm: depth,
            thicknessMm: 2,
            material: 'paper',
            interactive: false,
            exportRole: 'project-reference'
        }));
    });

    const joints = project.skeleton?.joints ?? {};
    (project.skeleton?.bones ?? [])
        .map(([parentId, childId]) => ({ parentId, childId, sourceId: `${parentId}->${childId}` }))
        .filter(bone => joints[bone.parentId] && joints[bone.childId])
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        .forEach(bone => {
            nodes.push(baseNode({
                id: `/skeleton/bones/${pathSegment(bone.sourceId)}`,
                sourceType: 'bone',
                sourceId: bone.sourceId,
                label: bone.sourceId,
                geometry: {
                    kind: 'line',
                    from: clonePoint(joints[bone.parentId].position),
                    to: clonePoint(joints[bone.childId].position),
                    width: 2
                },
                transform2d: { x: 0, y: 0, rotationRad: 0, scale: 1 },
                depthMm: nodeDepth('bone', 20),
                thicknessMm: 0.8,
                material: 'ghost',
                interactive: false,
                exportRole: 'project-reference'
            }));
        });

    Object.keys(joints).sort().forEach(jointId => {
        const joint = joints[jointId];
        nodes.push(baseNode({
            id: `/skeleton/${pathSegment(joint.id)}`,
            sourceType: 'joint',
            sourceId: joint.id,
            label: joint.name || joint.id,
            geometry: { kind: 'circle', center: clonePoint(joint.position), radius: joint.locked ? 5 : 4 },
            transform2d: { x: joint.position.x, y: joint.position.y, rotationRad: 0, scale: 1 },
            depthMm: nodeDepth('joint', 20.5),
            thicknessMm: 1.4,
            material: 'pin',
            interactive: !joint.locked,
            exportRole: 'project-reference'
        }));
    });

    Object.keys(project.paths).sort().forEach(pathId => {
        const path = project.paths[pathId];
        if (!path.visible || !path.points.length) return;
        const depth = nodeDepth('path', path.sceneObjectId ? (sceneObjectDepth.get(path.sceneObjectId) ?? 12) : (partDepth.get(path.partId) ?? 10));
        nodes.push(baseNode({
            id: `/paths/${pathSegment(path.id)}`,
            sourceType: 'path',
            sourceId: path.id,
            label: path.id,
            geometry: { kind: 'polyline', points: path.points.map(clonePoint), closed: path.closed, width: 4 },
            transform2d: { x: 0, y: 0, rotationRad: 0, scale: 1 },
            depthMm: depth,
            thicknessMm: 0.4,
            material: 'pathRibbon',
            interactive: true,
            exportRole: 'project-reference'
        }));
    });

    project.mechanisms.forEach((mechanism, index) => {
        if (!mechanism.visible || mechanism.enabled === false) return;
        const anchor = mechanismAnchor(mechanism);
        const resolvedMechanism = { ...mechanism, anchorX: anchor.x, anchorY: anchor.y };
        const state = calculateLinkage(resolvedMechanism, 0);
        const depth = mechanismNodeDepth(index);
        const baseId = `/mechanisms/${pathSegment(mechanism.id)}`;
        const templateLabel = mechanismTemplateLabel(mechanism.type);
        nodes.push(baseNode({
            id: `${baseId}/base`,
            sourceType: 'mechanism',
            sourceId: mechanism.id,
            label: `${templateLabel} base`,
            geometry: { kind: 'circle', center: anchor, radius: 6 },
            transform2d: { x: anchor.x, y: anchor.y, rotationRad: rotationRad(mechanism.groundAngle ?? 0), scale: 1 },
            depthMm: depth,
            thicknessMm: 2.2,
            material: 'toyMetal',
            interactive: true,
            exportRole: 'fabrication'
        }));
        nodes.push(baseNode({
            id: `${baseId}/output`,
            sourceType: 'mechanism',
            sourceId: mechanism.id,
            label: `${templateLabel} output`,
            geometry: { kind: 'circle', center: clonePoint(state.effector), radius: 5 },
            transform2d: { x: state.effector.x, y: state.effector.y, rotationRad: 0, scale: 1 },
            depthMm: depth + 0.5,
            thicknessMm: 2,
            material: state.isValid ? 'pin' : 'warning',
            interactive: true,
            exportRole: 'fabrication'
        }));
        nodes.push(baseNode({
            id: `${baseId}/link/base-to-output`,
            sourceType: 'hardware',
            parentId: `${baseId}/base`,
            label: `${templateLabel} linkage preview`,
            geometry: { kind: 'line', from: anchor, to: clonePoint(state.effector), width: 3 },
            transform2d: { x: 0, y: 0, rotationRad: 0, scale: 1 },
            depthMm: depth + 0.25,
            thicknessMm: 1,
            material: 'toyMetal',
            interactive: false,
            exportRole: 'preview-only'
        }));

        const anchorPoint = clonePoint(state.effector);
        labels.push({
            id: `/labels/mechanisms/${pathSegment(mechanism.id)}`,
            text: mechanism.targetPartId ? `drives ${mechanism.targetPartId}` : mechanism.targetSceneObjectId ? `drives ${mechanism.targetSceneObjectId}` : `${templateLabel} preview`,
            anchorNodeId: `${baseId}/output`,
            anchorPoint,
            severity: mechanism.targetPartId || mechanism.targetSceneObjectId ? 'info' : 'warning',
            collapsible: true
        });

        if (!state.isValid) {
            warnings.push({
                id: `/warnings/mechanisms/${pathSegment(mechanism.id)}/invalid-sample`,
                severity: 'warning',
                message: `${templateLabel}: no output at phase 0`,
                sourceNodeId: `${baseId}/output`,
                sourceType: 'mechanism',
                sourceId: mechanism.id,
                recoveryStage: 'design'
            });
        }
        (mechanism.warnings ?? []).forEach((message, warningIndex) => {
            warnings.push({
                id: `/warnings/mechanisms/${pathSegment(mechanism.id)}/${warningIndex}`,
                severity: 'warning',
                message,
                sourceNodeId: `${baseId}/base`,
                sourceType: 'mechanism',
                sourceId: mechanism.id,
                recoveryStage: 'design'
            });
        });
    });

    warnings.forEach(warning => {
        const anchorNode = warning.sourceNodeId ? nodes.find(node => node.id === warning.sourceNodeId) : undefined;
        labels.push({
            id: `/labels${warning.id}`,
            text: warning.message,
            anchorNodeId: warning.sourceNodeId,
            anchorPoint: anchorNode ? geometryAnchor(anchorNode.geometry) : { x: 0, y: 0 },
            severity: warning.severity,
            collapsible: true
        });
    });

    const selectInteractions: InteractionBinding[] = applyRenderOrder(nodes)
        .filter(node => node.interactive)
        .map(node => ({
            id: `/interactions/select${node.id}`,
            type: 'select-source',
            enabled: true,
            sourceType: node.sourceType,
            sourceId: node.sourceId,
            nodeId: node.id,
            writesProject: false
        }));
    const baseInteractions: InteractionBinding[] = [
        { id: '/interactions/draw-path-on-plane', type: 'draw-path-on-plane', enabled: true, sourceType: 'path', writesProject: true },
        { id: '/interactions/pan-zoom-locked-camera', type: 'pan-zoom-locked-camera', enabled: true, writesProject: false },
        { id: '/interactions/unlock-camera', type: 'unlock-camera', enabled: true, writesProject: false },
        { id: '/interactions/bake-3d-transform', type: 'bake-3d-transform', enabled: false, writesProject: false, reason: '3D transform bake is disabled until an explicit undoable project action exists.' }
    ];

    return {
        version: 1,
        units: { scene: 'px', depth: 'mm', scenePxPerMm: SCENE_PX_PER_MM },
        coordinateSystem: { x: 'right', y: 'up', z: 'toward-camera-depth' },
        nodes: applyRenderOrder(nodes),
        labels: labels.sort((a, b) => a.id.localeCompare(b.id)),
        cameras: [
            { id: 'locked-2.5d', label: '2.5D Locked', locked: true, orbitEnabled: false, position: { x: 0, y: 0, zMm: 500 }, lookAt: { x: 0, y: 0, zMm: 0 }, zoom: 1 },
            { id: 'depth-inspect', label: 'Depth Inspect', locked: true, orbitEnabled: false, position: { x: 420, y: 0, zMm: 240 }, lookAt: { x: 0, y: 0, zMm: 0 }, zoom: 1 },
            { id: 'toy-stage', label: 'Toy Stage', locked: false, orbitEnabled: true, position: { x: 260, y: -220, zMm: 360 }, lookAt: { x: 0, y: 0, zMm: 0 }, zoom: 1 },
            { id: 'assembly-exploded', label: 'Exploded Assembly', locked: true, orbitEnabled: false, position: { x: 260, y: -180, zMm: 420 }, lookAt: { x: 0, y: 0, zMm: 20 }, zoom: 0.9 },
            { id: 'inspect-free', label: 'Inspect', locked: false, orbitEnabled: true, position: { x: 320, y: -260, zMm: 440 }, lookAt: { x: 0, y: 0, zMm: 0 }, zoom: 1 }
        ],
        interactions: [...baseInteractions, ...selectInteractions].sort((a, b) => a.id.localeCompare(b.id)),
        warnings: warnings.sort((a, b) => a.id.localeCompare(b.id))
    };
};
