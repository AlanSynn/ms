import type { BodyPartLayer, MechanismConfig, Point, ProjectMotionPath, ProjectState, SceneObject, StandardSkeleton } from '../types';
import { mechanismFeature, type MechanismFeatureIssue } from './mechanismFeatureRegistry';
import { normalizeGearMeshMechanism } from './mechanismRecommendations';
import { motionPreviewForProject, pointOnProjectPath } from './motion';

export interface DesignAutomataProjection {
    mechanism?: MechanismConfig;
    mechanisms: MechanismConfig[];
    animatedParts: Record<string, BodyPartLayer>;
    animatedSceneObjects: Record<string, SceneObject>;
    skeleton: StandardSkeleton | null;
    userPath?: ProjectMotionPath;
    mechanismPath?: ProjectMotionPath;
    target?: Point;
    generatedTarget?: Point;
    targetJointId?: string;
    targetError?: number;
    motionSource: 'generatedPath' | 'linkage-effector' | 'missing-target' | 'none';
    featureLabel?: string;
    featureIssues: MechanismFeatureIssue[];
}

const firstVisiblePath = (project: ProjectState) =>
    Object.values(project.paths).find(path => path.visible !== false);

const targetPathForMechanism = (project: ProjectState, mechanism?: MechanismConfig) => {
    const explicit = mechanism?.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const selected = project.selectedPathId ? project.paths[project.selectedPathId] : undefined;
    return explicit ?? selected ?? firstVisiblePath(project);
};

const generatedPathForMechanism = (mechanism: MechanismConfig): ProjectMotionPath | undefined => {
    if (!mechanism.generatedPath?.length) return undefined;
    return {
        id: `${mechanism.id}-mechanism-path`,
        partId: mechanism.targetSceneObjectId ? '' : (mechanism.targetPartId ?? ''),
        sceneObjectId: mechanism.targetSceneObjectId,
        targetAnchorJointId: mechanism.targetAnchorJointId,
        points: mechanism.generatedPath,
        duration: 1,
        closed: true,
        enabled: true,
        visible: true,
        source: 'generated',
        warnings: []
    };
};

export const buildDesignAutomataProjection = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    angle: number
): DesignAutomataProjection => {
    if (!mechanism) {
        return {
            mechanisms: [],
            animatedParts: {},
            animatedSceneObjects: {},
            skeleton: project.skeleton,
            motionSource: 'none',
            featureIssues: []
        };
    }

    const normalizedMechanisms = project.mechanisms.map(normalizeGearMeshMechanism);
    const normalizedMechanism =
        normalizedMechanisms.find(item => item.id === mechanism.id) ??
        normalizeGearMeshMechanism(mechanism);
    const sceneMechanisms = normalizedMechanisms.length ? normalizedMechanisms : [normalizedMechanism];
    const feature = mechanismFeature(normalizedMechanism.type);
    const motionPreview = motionPreviewForProject(project, sceneMechanisms, angle);
    const selectedMotionPreview = motionPreviewForProject(project, [normalizedMechanism], angle);
    const mechanismPath = generatedPathForMechanism(normalizedMechanism);
    const generatedTarget = mechanismPath ? pointOnProjectPath(mechanismPath, angle) : undefined;
    const targetError = generatedTarget && selectedMotionPreview.target
        ? Math.hypot(selectedMotionPreview.target.x - generatedTarget.x, selectedMotionPreview.target.y - generatedTarget.y)
        : undefined;
    const source = generatedTarget && selectedMotionPreview.target
        ? 'generatedPath'
        : generatedTarget
            ? 'missing-target'
            : 'linkage-effector';

    return {
        mechanism: normalizedMechanism,
        mechanisms: sceneMechanisms,
        animatedParts: motionPreview.parts,
        animatedSceneObjects: motionPreview.sceneObjects ?? {},
        skeleton: motionPreview.skeleton ?? project.skeleton,
        userPath: targetPathForMechanism(project, normalizedMechanism),
        mechanismPath,
        target: selectedMotionPreview.target,
        generatedTarget,
        targetJointId: selectedMotionPreview.targetJointId,
        targetError,
        motionSource: source,
        featureLabel: feature.label,
        featureIssues: feature.validate(normalizedMechanism)
    };
};
