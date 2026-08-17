import type {
    BodyPartLayer,
    MechanismConfig,
    Point,
    ProjectMotionPath,
    ProjectState,
    SceneObject,
    StandardSkeleton
} from '../types';
import { mechanismFeature, type MechanismFeatureIssue } from './mechanismFeatureRegistry';
import { normalizeGearMeshMechanism } from './mechanismRecommendations';
import { buildMechanismSceneContract, type MechanismSceneContract } from './mechanismSceneContract';
import { buildFoundryMechanismPreviewModel, type FoundryMechanismPreviewModel } from './foundryPreviewModel';
import {
    mechanismBindingWarnings,
    mechanismPathFitIsUsable,
    motionPreviewForProject,
    pointOnGeneratedMechanismPath,
    pointOnProjectPath,
} from './motion';

export type AutomataSceneMode = 'design-live' | 'assembly-live';

export type AutomataSceneModel = {
    mode: AutomataSceneMode;
    mechanism?: MechanismConfig;
    mechanisms: MechanismConfig[];
    foundryPreview?: FoundryMechanismPreviewModel;
    mechanismContract?: MechanismSceneContract;
    animatedParts: Record<string, BodyPartLayer>;
    animatedSceneObjects: Record<string, SceneObject>;
    skeleton: StandardSkeleton | null;
    userPath?: ProjectMotionPath;
    mechanismPath?: ProjectMotionPath;
    target?: Point;
    generatedTarget?: Point;
    targetJointId?: string;
    targetError?: number;
    generatedPathError?: number;
    motionSource: 'linkage-trace' | 'linkage-effector' | 'missing-target' | 'none';
    featureLabel?: string;
    featureIssues: MechanismFeatureIssue[];
    warnings: Record<string, string[]>;
};

const targetPathForMechanism = (project: ProjectState, mechanism?: MechanismConfig) => {
    const explicit = mechanism?.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const selected = project.selectedPathId ? project.paths[project.selectedPathId] : undefined;
    return explicit ?? selected;
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

export const buildAutomataSceneModel = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    angle: number,
    mode: AutomataSceneMode = 'design-live'
): AutomataSceneModel => {
    if (!mechanism) {
        return {
            mode,
            mechanisms: [],
            animatedParts: {},
            animatedSceneObjects: {},
            skeleton: project.skeleton,
            motionSource: 'none',
            featureIssues: [],
            warnings: {}
        };
    }

    const normalizedMechanisms = project.mechanisms.map(normalizeGearMeshMechanism);
    const normalizedMechanism =
        normalizedMechanisms.find(item => item.id === mechanism.id) ??
        normalizeGearMeshMechanism(mechanism);
    const mechanisms = normalizedMechanisms.length ? normalizedMechanisms : [normalizedMechanism];
    const userPath = targetPathForMechanism(project, normalizedMechanism);
    const foundryPreview = buildFoundryMechanismPreviewModel(
        normalizedMechanism,
        angle,
        project.settings,
        userPath?.points ?? [],
        360,
        240,
        96,
        'scene'
    );
    const fullMotionPreview = motionPreviewForProject(project, mechanisms, angle);
    const selectedMotionPreview = motionPreviewForProject(project, [normalizedMechanism], angle);
    const mechanismPath = generatedPathForMechanism(normalizedMechanism);
    const generatedTarget = mechanismPath ? pointOnGeneratedMechanismPath(mechanismPath.points, angle) : undefined;
    const authoredTarget = userPath ? pointOnProjectPath(userPath, angle) : undefined;
    const targetError = authoredTarget && selectedMotionPreview.target
        ? Math.hypot(selectedMotionPreview.target.x - authoredTarget.x, selectedMotionPreview.target.y - authoredTarget.y)
        : undefined;
    const generatedPathError = generatedTarget && selectedMotionPreview.target
        ? Math.hypot(selectedMotionPreview.target.x - generatedTarget.x, selectedMotionPreview.target.y - generatedTarget.y)
        : undefined;
    const motionSource = selectedMotionPreview.target
        ? normalizedMechanism.fabricationMetadata?.pathFit?.outputTraceId
            ? 'linkage-trace'
            : 'linkage-effector'
        : normalizedMechanism.type === '4bar' && normalizedMechanism.targetPathId && !mechanismPathFitIsUsable(project, normalizedMechanism)
            ? 'missing-target'
        : generatedTarget
            ? 'missing-target'
            : 'linkage-effector';
    const feature = mechanismFeature(normalizedMechanism.type);

    return {
        mode,
        mechanism: normalizedMechanism,
        mechanisms,
        foundryPreview,
        mechanismContract: buildMechanismSceneContract(normalizedMechanism),
        animatedParts: fullMotionPreview.parts,
        animatedSceneObjects: fullMotionPreview.sceneObjects ?? {},
        skeleton: fullMotionPreview.skeleton ?? project.skeleton,
        userPath,
        mechanismPath,
        target: selectedMotionPreview.target,
        generatedTarget,
        targetJointId: selectedMotionPreview.targetJointId,
        targetError,
        generatedPathError,
        motionSource,
        featureLabel: feature.label,
        featureIssues: feature.validate(normalizedMechanism),
        warnings: mechanismBindingWarnings(project, mechanisms)
    };
};
