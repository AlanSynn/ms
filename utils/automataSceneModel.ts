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
import { buildProjectMechanismSceneContract, type MechanismSceneContract } from './mechanismSceneContract';
import {
    prepareFoundryMechanismPreviewModel,
    samplePreparedFoundryMechanismPreviewModel,
    type FoundryMechanismPreviewModel,
    type PreparedFoundryMechanismPreviewModel,
} from './foundryPreviewModel';
import { resolveMechanismRuntimeGate, runtimeMechanisms } from './mechanismRuntimePolicy';
import {
    mechanismBindingWarnings,
    pointOnGeneratedMechanismPath,
    pointOnProjectPath,
    prepareMotionPreviewForProject,
    samplePreparedMotionPreview,
    type PreparedProjectMotionPreview,
} from './motion';

export type AutomataSceneMode = 'design-live' | 'assembly-live';

export type AutomataSceneModel = {
    mode: AutomataSceneMode;
    mechanism?: MechanismConfig;
    recoveryMechanism?: MechanismConfig;
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

export type PreparedAutomataSceneModel = {
    kind: 'empty' | 'hidden' | 'recovery' | 'active';
    mode: AutomataSceneMode;
    project: ProjectState;
    activeMechanism?: MechanismConfig;
    recoveryMechanism?: MechanismConfig;
    mechanisms: MechanismConfig[];
    foundryPreview?: PreparedFoundryMechanismPreviewModel;
    staticFoundryPreview?: FoundryMechanismPreviewModel;
    mechanismContract?: MechanismSceneContract;
    fullMotion?: PreparedProjectMotionPreview;
    selectedMotion?: PreparedProjectMotionPreview;
    userPath?: ProjectMotionPath;
    mechanismPath?: ProjectMotionPath;
    pathFitError?: number;
    pathFitThreshold?: number;
    pathFitStatus: AutomataSceneModel['pathFitStatus'];
    featureLabel?: string;
    featureIssues: MechanismFeatureIssue[];
    warnings: Record<string, string[]>;
};

const targetPathForMechanism = (project: ProjectState, mechanism?: MechanismConfig) => {
    return mechanism?.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
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

export const prepareAutomataSceneModel = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    mode: AutomataSceneMode = 'design-live',
    contractAngleRad = 0,
): PreparedAutomataSceneModel => {
    if (!mechanism) {
        return {
            kind: 'empty',
            mode,
            project,
            mechanisms: [],
            pathFitStatus: 'unmeasured',
            featureIssues: [],
            warnings: {},
        };
    }

    const authoredMechanisms = Object.values(project.mechanisms);
    const activeMechanisms = runtimeMechanisms(project, authoredMechanisms);
    const authoredCandidate = authoredMechanisms.find(item => item.id === mechanism.id);
    const activeMechanism = activeMechanisms.find(item => item.id === mechanism.id);
    const selectedGate = authoredCandidate
        ? resolveMechanismRuntimeGate(project, authoredCandidate)
        : undefined;
    const fullMotion = prepareMotionPreviewForProject(project, activeMechanisms);
    if (!activeMechanism && selectedGate?.projection !== 'static-recovery') {
        return {
            kind: 'hidden',
            mode,
            project,
            mechanisms: activeMechanisms,
            fullMotion,
            pathFitStatus: 'unmeasured',
            featureIssues: [],
            warnings: mechanismBindingWarnings(project, activeMechanisms),
        };
    }
    if (!activeMechanism && authoredCandidate && selectedGate?.projection === 'static-recovery') {
        const staticMechanism = { ...authoredCandidate, generatedPath: undefined };
        const preparedFoundry = prepareFoundryMechanismPreviewModel({
            mechanism: staticMechanism,
            settings: project.settings,
            frame: 'scene',
        });
        const feature = mechanismFeature(staticMechanism.type);
        return {
            kind: 'recovery',
            mode,
            project,
            recoveryMechanism: authoredCandidate,
            mechanisms: activeMechanisms,
            staticFoundryPreview: samplePreparedFoundryMechanismPreviewModel(
                preparedFoundry,
                0,
            ),
            mechanismContract: buildProjectMechanismSceneContract(project, authoredCandidate.id, undefined, 0),
            fullMotion,
            pathFitStatus: 'unmeasured',
            featureLabel: feature.label,
            featureIssues: feature.validate(staticMechanism),
            warnings: mechanismBindingWarnings(project, authoredMechanisms),
        };
    }
    if (!activeMechanism) throw new Error('Active mechanism lookup failed');
    const mechanisms = activeMechanisms;
    const userPath = targetPathForMechanism(project, activeMechanism);
    const preparedByMechanismId = new Map(
        fullMotion.mechanisms.map(entry => [entry.mechanism.id, entry.kinematics]),
    );
    const selectedMotion = prepareMotionPreviewForProject(
        project,
        [activeMechanism],
        preparedByMechanismId,
    );
    const selectedKinematics = selectedMotion.mechanisms[0]?.kinematics;
    const foundryPreview = prepareFoundryMechanismPreviewModel({
        mechanism: activeMechanism,
        settings: project.settings,
        userPathPoints: userPath?.points ?? [],
        frame: 'scene',
        ...(selectedKinematics ? { kinematics: selectedKinematics } : {}),
    });
    const mechanismPath = generatedPathForMechanism(activeMechanism);
    const pathFitError = generatedPathPhaseError(activeMechanism.generatedPath, userPath);
    const pathFitThreshold = userPath ? generatedPathFitThreshold(userPath) : undefined;
    const pathFitStatus = pathFitError === undefined || pathFitThreshold === undefined
        ? 'unmeasured'
        : pathFitError > pathFitThreshold
            ? 'mismatch'
            : 'fit';
    const feature = mechanismFeature(activeMechanism.type);
    const warnings = mechanismBindingWarnings(project, mechanisms);
    if (pathFitStatus === 'mismatch') {
        warnings[activeMechanism.id] = [
            ...(warnings[activeMechanism.id] ?? []),
            'Fit path before attaching the character.'
        ];
    }

    return {
        kind: 'active',
        mode,
        project,
        activeMechanism,
        mechanisms,
        foundryPreview,
        mechanismContract: buildProjectMechanismSceneContract(
            project,
            activeMechanism.id,
            undefined,
            contractAngleRad,
        ),
        fullMotion,
        selectedMotion,
        userPath,
        mechanismPath,
        pathFitError,
        pathFitThreshold,
        pathFitStatus,
        featureLabel: feature.label,
        featureIssues: feature.validate(activeMechanism),
        warnings,
    };
};

export const samplePreparedAutomataSceneModel = (
    prepared: PreparedAutomataSceneModel,
    angle: number,
): AutomataSceneModel => {
    const { project } = prepared;
    if (prepared.kind === 'empty') {
        return {
            mode: prepared.mode,
            mechanisms: [],
            animatedParts: {},
            animatedSceneObjects: {},
            skeleton: project.skeleton,
            motionSource: 'none',
            pathFitStatus: 'unmeasured',
            featureIssues: [],
            warnings: {},
        };
    }

    const fullMotionPreview = prepared.fullMotion
        ? samplePreparedMotionPreview(prepared.fullMotion, angle)
        : { parts: {}, sceneObjects: {}, skeleton: project.skeleton };
    if (prepared.kind === 'hidden') {
        return {
            mode: prepared.mode,
            mechanisms: prepared.mechanisms,
            animatedParts: fullMotionPreview.parts,
            animatedSceneObjects: fullMotionPreview.sceneObjects ?? {},
            skeleton: fullMotionPreview.skeleton ?? project.skeleton,
            motionSource: 'none',
            pathFitStatus: 'unmeasured',
            featureIssues: [],
            warnings: prepared.warnings,
        };
    }
    if (prepared.kind === 'recovery') {
        return {
            mode: prepared.mode,
            recoveryMechanism: prepared.recoveryMechanism,
            mechanisms: prepared.mechanisms,
            foundryPreview: prepared.staticFoundryPreview,
            mechanismContract: prepared.mechanismContract,
            animatedParts: fullMotionPreview.parts,
            animatedSceneObjects: fullMotionPreview.sceneObjects ?? {},
            skeleton: fullMotionPreview.skeleton ?? project.skeleton,
            motionSource: 'none',
            pathFitStatus: 'unmeasured',
            featureLabel: prepared.featureLabel,
            featureIssues: prepared.featureIssues,
            warnings: prepared.warnings,
        };
    }

    const activeMechanism = prepared.activeMechanism!;
    const selectedMotionPreview = samplePreparedMotionPreview(
        prepared.selectedMotion!,
        angle,
    );
    const generatedTarget = prepared.mechanismPath
        ? pointOnGeneratedMechanismPath(prepared.mechanismPath.points, angle)
        : undefined;
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
    return {
        mode: prepared.mode,
        mechanism: activeMechanism,
        mechanisms: prepared.mechanisms,
        foundryPreview: samplePreparedFoundryMechanismPreviewModel(
            prepared.foundryPreview!,
            angle,
        ),
        mechanismContract: prepared.mechanismContract,
        animatedParts: fullMotionPreview.parts,
        animatedSceneObjects: fullMotionPreview.sceneObjects ?? {},
        skeleton: fullMotionPreview.skeleton ?? project.skeleton,
        userPath: prepared.userPath,
        mechanismPath: prepared.mechanismPath,
        target: selectedMotionPreview.target,
        generatedTarget,
        targetJointId: selectedMotionPreview.targetJointId,
        targetError,
        pathFitError: prepared.pathFitError,
        pathFitThreshold: prepared.pathFitThreshold,
        pathFitStatus: prepared.pathFitStatus,
        motionSource,
        featureLabel: prepared.featureLabel,
        featureIssues: prepared.featureIssues,
        warnings: prepared.warnings,
    };
};

export const buildAutomataSceneModel = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    angle: number,
    mode: AutomataSceneMode = 'design-live'
): AutomataSceneModel => samplePreparedAutomataSceneModel(
    prepareAutomataSceneModel(project, mechanism, mode, angle),
    angle,
);
