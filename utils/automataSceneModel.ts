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
import { mechanismBindingWarnings, motionPreviewForProject, pointOnGeneratedMechanismPath, pointOnProjectPath } from './motion';

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
    pathFitError?: number;
    pathFitThreshold?: number;
    pathFitStatus: 'fit' | 'mismatch' | 'unmeasured';
    motionSource: 'generatedPath' | 'linkage-effector' | 'missing-target' | 'none';
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

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const pathBoundsDiagonal = (points: Point[]) => {
    if (!points.length) return 0;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

const generatedPathFitThreshold = (path: ProjectMotionPath) =>
    Math.max(80, Math.min(160, pathBoundsDiagonal(path.points) * 1.25));

const generatedPathPhaseError = (generatedPath: Point[] | undefined, userPath: ProjectMotionPath | undefined) => {
    if (!generatedPath?.length || !userPath?.points.length) return undefined;
    const sampleCount = 24;
    let total = 0;
    for (let index = 0; index < sampleCount; index += 1) {
        const angle = (index / sampleCount) * Math.PI * 2;
        const generated = pointOnGeneratedMechanismPath(generatedPath, angle);
        if (!generated) return undefined;
        total += distance(generated, pointOnProjectPath(userPath, angle));
    }
    return total / sampleCount;
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
            pathFitStatus: 'unmeasured',
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
    const mechanismPath = generatedPathForMechanism(normalizedMechanism);
    const pathFitError = generatedPathPhaseError(normalizedMechanism.generatedPath, userPath);
    const pathFitThreshold = userPath ? generatedPathFitThreshold(userPath) : undefined;
    const pathFitStatus = pathFitError === undefined || pathFitThreshold === undefined
        ? 'unmeasured'
        : pathFitError > pathFitThreshold
            ? 'mismatch'
            : 'fit';
    const fullMotionPreview = motionPreviewForProject(project, mechanisms, angle);
    const selectedMotionPreview = motionPreviewForProject(project, [normalizedMechanism], angle);
    const generatedTarget = mechanismPath ? pointOnGeneratedMechanismPath(mechanismPath.points, angle) : undefined;
    const targetError = generatedTarget && selectedMotionPreview.target
        ? distance(selectedMotionPreview.target, generatedTarget)
        : undefined;
    const motionSource = generatedTarget && selectedMotionPreview.target
        ? 'generatedPath'
        : generatedTarget
            ? 'missing-target'
            : selectedMotionPreview.target
                ? 'linkage-effector'
                : 'none';
    const feature = mechanismFeature(normalizedMechanism.type);
    const warnings = mechanismBindingWarnings(project, mechanisms);
    if (pathFitStatus === 'mismatch') {
        warnings[normalizedMechanism.id] = [
            ...(warnings[normalizedMechanism.id] ?? []),
            'Fit path before attaching the character.'
        ];
    }

    return {
        mode,
        mechanism: normalizedMechanism,
        mechanisms,
        foundryPreview,
        mechanismContract: buildMechanismSceneContract(normalizedMechanism, undefined, project.settings.physicalKit),
        animatedParts: fullMotionPreview.parts,
        animatedSceneObjects: fullMotionPreview.sceneObjects ?? {},
        skeleton: fullMotionPreview.skeleton ?? project.skeleton,
        userPath,
        mechanismPath,
        target: selectedMotionPreview.target,
        generatedTarget,
        targetJointId: selectedMotionPreview.targetJointId,
        targetError,
        pathFitError,
        pathFitThreshold,
        pathFitStatus,
        motionSource,
        featureLabel: feature.label,
        featureIssues: feature.validate(normalizedMechanism),
        warnings
    };
};
