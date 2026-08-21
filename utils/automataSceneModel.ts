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
import {
    createFoundryMechanismPreviewRuntime,
    sampleFoundryMechanismPreviewRuntime,
    type FoundryMechanismPreviewModel,
    type FoundryMechanismPreviewRuntime,
} from './foundryPreviewModel';
import {
    mechanismBindingWarnings,
    motionPreviewForProject,
    pointOnGeneratedMechanismPath,
    pointOnProjectPath,
} from './motion';
import { resolveRenderPerformancePolicy } from './renderPerformancePolicy';

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
    motionSource: 'linkage-trace' | 'missing-target' | 'none';
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

export type AutomataSceneRuntime = {
    mode: AutomataSceneMode;
    project: ProjectState;
    mechanism?: MechanismConfig;
    mechanisms: MechanismConfig[];
    foundryPreview?: FoundryMechanismPreviewRuntime;
    mechanismContract?: MechanismSceneContract;
    userPath?: ProjectMotionPath;
    mechanismPath?: ProjectMotionPath;
    featureLabel?: string;
    featureIssues: MechanismFeatureIssue[];
    warnings: Record<string, string[]>;
};

type ProjectAutomataRuntimeCache = {
    byMechanism: WeakMap<MechanismConfig, Partial<Record<AutomataSceneMode, AutomataSceneRuntime>>>;
    withoutMechanism: Partial<Record<AutomataSceneMode, AutomataSceneRuntime>>;
};

const automataRuntimeCache = new WeakMap<ProjectState, ProjectAutomataRuntimeCache>();
const automataSampleCache = new WeakMap<AutomataSceneRuntime, Map<number, AutomataSceneModel>>();
const AUTOMATA_SAMPLE_CACHE_LIMIT = 4;

export const createAutomataSceneRuntime = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    mode: AutomataSceneMode = 'design-live'
): AutomataSceneRuntime => {
    if (!mechanism) {
        return {
            mode,
            project,
            mechanisms: [],
            featureIssues: [],
            warnings: {},
        };
    }

    const normalizedMechanisms = project.mechanisms.map(normalizeGearMeshMechanism);
    const normalizedMechanism =
        normalizedMechanisms.find(item => item.id === mechanism.id) ??
        normalizeGearMeshMechanism(mechanism);
    const mechanisms = normalizedMechanisms.length ? normalizedMechanisms : [normalizedMechanism];
    const userPath = targetPathForMechanism(project, normalizedMechanism);
    const feature = mechanismFeature(normalizedMechanism.type);
    const renderPolicy = resolveRenderPerformancePolicy(project.settings.performancePreset);
    return {
        mode,
        project,
        mechanism: normalizedMechanism,
        mechanisms,
        foundryPreview: createFoundryMechanismPreviewRuntime(
            normalizedMechanism,
            project.settings,
            userPath?.points ?? [],
            360,
            240,
            renderPolicy.interactiveDetail.mechanismTraceSamples,
            'scene'
        ),
        mechanismContract: buildMechanismSceneContract(normalizedMechanism),
        userPath,
        mechanismPath: generatedPathForMechanism(normalizedMechanism),
        featureLabel: feature.label,
        featureIssues: feature.validate(normalizedMechanism),
        warnings: mechanismBindingWarnings(project, mechanisms),
    };
};

export const reuseAutomataSceneRuntime = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    mode: AutomataSceneMode = 'design-live'
): AutomataSceneRuntime => {
    let projectCache = automataRuntimeCache.get(project);
    if (!projectCache) {
        projectCache = {
            byMechanism: new WeakMap(),
            withoutMechanism: {},
        };
        automataRuntimeCache.set(project, projectCache);
    }
    if (!mechanism) {
        return projectCache.withoutMechanism[mode] ??=
            createAutomataSceneRuntime(project, undefined, mode);
    }
    let mechanismCache = projectCache.byMechanism.get(mechanism);
    if (!mechanismCache) {
        mechanismCache = {};
        projectCache.byMechanism.set(mechanism, mechanismCache);
    }
    return mechanismCache[mode] ??=
        createAutomataSceneRuntime(project, mechanism, mode);
};

export const sampleAutomataSceneRuntime = (
    runtime: AutomataSceneRuntime,
    angle: number
): AutomataSceneModel => {
    const {
        mode,
        project,
        mechanism,
        mechanisms,
        foundryPreview,
        mechanismContract,
        userPath,
        mechanismPath,
        featureLabel,
        featureIssues,
        warnings,
    } = runtime;
    if (!mechanism || !foundryPreview) {
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

    const preview = sampleFoundryMechanismPreviewRuntime(foundryPreview, angle);
    const fullMotionPreview = motionPreviewForProject(project, mechanisms, angle);
    const selectedMotionPreview = motionPreviewForProject(project, [mechanism], angle);
    const generatedTarget = mechanismPath ? pointOnGeneratedMechanismPath(mechanismPath.points, angle) : undefined;
    const authoredTarget = userPath ? pointOnProjectPath(userPath, angle) : undefined;
    const targetError = authoredTarget && selectedMotionPreview.target
        ? Math.hypot(selectedMotionPreview.target.x - authoredTarget.x, selectedMotionPreview.target.y - authoredTarget.y)
        : undefined;
    const generatedPathError = generatedTarget && selectedMotionPreview.target
        ? Math.hypot(selectedMotionPreview.target.x - generatedTarget.x, selectedMotionPreview.target.y - generatedTarget.y)
        : undefined;
    const motionSource = selectedMotionPreview.target ? 'linkage-trace' : 'missing-target';

    return {
        mode,
        mechanism,
        mechanisms,
        foundryPreview: preview,
        mechanismContract,
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
        featureLabel,
        featureIssues,
        warnings,
    };
};

export const sampleReusableAutomataSceneRuntime = (
    runtime: AutomataSceneRuntime,
    angle: number,
): AutomataSceneModel => {
    let cache = automataSampleCache.get(runtime);
    if (!cache) {
        cache = new Map();
        automataSampleCache.set(runtime, cache);
    }
    const cached = cache.get(angle);
    if (cached) {
        cache.delete(angle);
        cache.set(angle, cached);
        return cached;
    }
    const sampled = sampleAutomataSceneRuntime(runtime, angle);
    cache.set(angle, sampled);
    while (cache.size > AUTOMATA_SAMPLE_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
    return sampled;
};

export const buildAutomataSceneModel = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    angle: number,
    mode: AutomataSceneMode = 'design-live'
): AutomataSceneModel =>
    sampleReusableAutomataSceneRuntime(
        reuseAutomataSceneRuntime(project, mechanism, mode),
        angle
    );
