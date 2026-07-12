import type { FabricationPartRequirement, FabricationRecipe, MechanismConfig, PhysicalKitSettings, ProjectState } from '../types';
import { boardToScene, defaultPhysicalKit, sceneToBoardRaw } from './coordinates';
import { assemblyStepFingerprint, type AssemblyStepFingerprint } from './fabricationAssemblyFingerprint';
import { sampleFeasibleRange, type FabricationFeasibleRange } from './fabricationReadiness';
import type { FabricationRenderPlan } from './mechanismFabricationZStack';
import { compileGraphFabricationRecipe, type AuthoredGraphFabricationResult } from './mechanismGraphFabricationCompiler';
import {
    MECHANISM_GRAPH_IR_VERSION,
    mechanismGraphForMechanism,
    sampleMechanismGraphMotion,
    validateMechanismGraph,
    type MechanismGraph,
    type MechanismGraphDiagnostic,
    type MechanismGraphMotionSample
} from './mechanismGraph';
import type { ConnectionSelectionSummary } from './mechanismConnectionSelections';
import { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';
import { preferredMotionJointId } from './motion';

export type CompiledAssemblyStepFingerprint = AssemblyStepFingerprint;

export type MechanismCompilerSource = 'mechanismCompiler';
export type MechanismRecipeCompilerSource = 'compileGraphFabricationRecipe';

export type CompiledMechanism = {
    compilerSource: MechanismCompilerSource;
    graph: MechanismGraph;
    graphValidationDiagnostics: MechanismGraphDiagnostic[];
    motionSamples: MechanismGraphMotionSample[];
    feasibleRange: FabricationFeasibleRange;
    readinessErrors: string[];
    fabrication: {
        renderPlan: FabricationRenderPlan;
        renderPlanSource: 'compileGraphFabricationRecipe';
        assemblyPlanSource: 'compileGraphFabricationRecipe';
        recipeCompilerSource: MechanismRecipeCompilerSource;
        assemblyBoardCoordinate: string;
        assemblyStepCount: number;
        assemblyStepLabels: string[];
        assemblyStepFingerprints: CompiledAssemblyStepFingerprint[];
        layerCount: number;
        stackSummary: string;
        roleSummary: string;
        validationErrors: string[];
    };
};

export type MechanismGraphCompilerSummary = {
    compilerSource: MechanismCompilerSource;
    recipeCompilerSource: MechanismRecipeCompilerSource;
    irVersion: typeof MECHANISM_GRAPH_IR_VERSION;
    graphId: string;
    familyId: MechanismGraph['family']['id'];
    firstCompilerTarget: boolean;
    source: MechanismGraph['source'];
    solver: MechanismGraph['solver'];
    persisted: false;
    nodeCount: number;
    constraintCount: number;
    driverCount: number;
    diagnosticCount: number;
    diagnostics: MechanismGraphDiagnostic[];
    connectionSelectionSummary?: ConnectionSelectionSummary;
    motionSampleCount: number;
    feasiblePercentValid: number;
    readinessErrorCount: number;
    assemblyStepCount: number;
};

export type AuthoredGraphCompilation = {
    compilerSource: MechanismCompilerSource;
    graph: MechanismGraph;
    graphValidationDiagnostics: MechanismGraphDiagnostic[];
    fabrication: AuthoredGraphFabricationResult;
    blockers: string[];
};

const graphRecipeWithProjectContext = (
    project: ProjectState,
    mechanism: MechanismConfig,
    recipe: FabricationRecipe
): FabricationRecipe => {
    const targetPart = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
    const targetSceneObject = mechanism.targetSceneObjectId ? project.sceneObjects[mechanism.targetSceneObjectId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = targetPart
        ? preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId ?? targetPath?.targetAnchorJointId)
        : undefined;
    return {
        ...recipe,
        targetPartId: targetPart?.id,
        targetPartName: targetPart?.name,
        targetSceneObjectId: targetSceneObject?.id,
        targetSceneObjectName: targetSceneObject?.name,
        targetPathId: targetPath?.id,
        targetPathPointCount: targetPath?.points.length,
        targetAnchorJointId,
        camProfileSamples: mechanism.type === 'cam' ? [...(mechanism.camProfileSamples ?? [])] : recipe.camProfileSamples,
        warnings: [...recipe.warnings, ...(mechanism.fabricationMetadata?.warnings ?? []), ...(mechanism.warnings ?? [])]
    };
};

const graphCompilerBlockerPart = (blocker: string): FabricationPartRequirement => ({
    name: `Fix: ${blocker}`,
    label: blocker,
    key: 'compiler-blocker',
    category: 'blocker',
    quantity: 1
});

const graphCompilerBlockerStep = (
    mechanism: MechanismConfig,
    blocker: string,
    boardCoordinate: string
): FabricationRecipe['assemblySteps'][number] => ({
    index: 1,
    label: `Fix ${mechanism.type} module`,
    role: 'blocker',
    boardCoordinate,
    zMm: 0,
    coords: [boardCoordinate],
    coordRoles: ['board'],
    action: 'fix-before-build',
    instruction: `Fix: ${blocker}`,
    check: 'Build files are ready after the issue is fixed.',
    stack: [{ order: 1, label: `Fix: ${blocker}`, role: 'blocker', part: 'blockers:compiler-blocker' }]
});

const graphRecipeBlocker = (
    project: ProjectState,
    mechanism: MechanismConfig,
    blocker: string
): FabricationRecipe => {
    const kit = project.settings.physicalKit;
    const board = mechanism.fabricationMetadata?.sceneAnchor
        ? sceneToBoardRaw(mechanism.fabricationMetadata.sceneAnchor, kit)
        : sceneToBoardRaw({ x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }, kit);
    const boardCoordinate = board.label;
    const [col, row] = [board.col, board.row];
    const sceneAnchor = board.valid ? boardToScene(col, row, kit) : { x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 };
    return graphRecipeWithProjectContext(project, mechanism, {
        mechanismId: mechanism.id,
        type: 'graph',
        graphFamilyId: mechanism.type,
        graphSource: 'family-definition',
        compilerSource: 'mechanismCompiler',
        boardCoordinate,
        board: board.valid ? board : { col, row, xMm: 0, yMm: 0, valid: false },
        sceneAnchor,
        offsetFromBoardMm: { x: 0, y: 0 },
        requiredParts: [graphCompilerBlockerPart(blocker)],
        steps: [`Fix: ${blocker}`],
        assemblySteps: [graphCompilerBlockerStep(mechanism, blocker, boardCoordinate)],
        warnings: [`Fix: ${blocker}`]
    });
};

export const compileFabricationRecipe = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe =>
    {
        const graph = mechanismGraphForMechanism(mechanism);
    const compiled = compileGraphFabricationRecipe(graph, project.settings.physicalKit);
    return compiled.buildable && compiled.recipe
        ? graphRecipeWithProjectContext(project, mechanism, compiled.recipe)
        : graphRecipeBlocker(project, mechanism, compiled.blocker ?? 'Graph fabrication blocked');
    };

export const compileMechanismGraphFabrication = (
    mechanism: MechanismConfig,
    kit?: PhysicalKitSettings
): AuthoredGraphFabricationResult =>
    compileGraphFabricationRecipe(mechanismGraphForMechanism(mechanism), kit);

export const compileMechanismRenderPlan = (
    mechanism: MechanismConfig,
    kit?: PhysicalKitSettings
): FabricationRenderPlan => {
    return compileMechanismGraphFabrication(mechanism, kit).renderPlan;
};

export const compileAuthoredMechanismGraph = (graph: MechanismGraph, kit?: PhysicalKitSettings): AuthoredGraphCompilation => {
    const validation = validateMechanismGraph(graph);
    const fabrication = compileGraphFabricationRecipe(graph, kit);
    const fabricationBlockers = fabrication.buildable ? [] : [fabrication.blocker ?? 'Graph fabrication blocked'];
    return {
        compilerSource: 'mechanismCompiler',
        graph,
        graphValidationDiagnostics: validation.diagnostics,
        fabrication,
        blockers: [
            ...validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.message),
            ...fabricationBlockers
        ]
    };
};


export const compileMechanism = (
    mechanism: MechanismConfig,
    angles: number[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
    feasibleSamples = 24,
    kit?: PhysicalKitSettings
): CompiledMechanism => {
    const graph = mechanismGraphForMechanism(mechanism);
    const graphValidation = validateMechanismGraph(graph);
    const graphFabrication = compileGraphFabricationRecipe(graph, kit);
    const renderPlan = graphFabrication.renderPlan;
    const fallbackKit = kit ?? defaultPhysicalKit();
    const fallbackBoard = sceneToBoardRaw({ x: mechanism.anchorX ?? 0, y: mechanism.anchorY ?? 0 }, fallbackKit);
    const assemblyBoardCoordinate = graphFabrication.recipe?.boardCoordinate ?? mechanism.fabricationMetadata?.boardCoordinate ?? fallbackBoard.label;
    const graphBlocker = graphFabrication.blocker ?? renderPlan.validationErrors[0] ?? 'Graph fabrication blocked';
    const assemblySteps = graphFabrication.recipe?.assemblySteps ?? [graphCompilerBlockerStep(mechanism, graphBlocker, assemblyBoardCoordinate)];
    const fabricationValidationErrors = graphFabrication.recipe
        ? renderPlan.validationErrors
        : [...new Set([...renderPlan.validationErrors, graphBlocker])];
    return {
        compilerSource: 'mechanismCompiler',
        graph,
        graphValidationDiagnostics: graphValidation.diagnostics,
        motionSamples: angles.map(angle => sampleMechanismGraphMotion(mechanism, angle)),
        feasibleRange: sampleFeasibleRange(mechanism, feasibleSamples),
        readinessErrors: validateMechanismPreviewReadiness(mechanism, kit),
        fabrication: {
            renderPlan,
            renderPlanSource: 'compileGraphFabricationRecipe',
            assemblyPlanSource: 'compileGraphFabricationRecipe',
            recipeCompilerSource: 'compileGraphFabricationRecipe',
            assemblyBoardCoordinate,
            assemblyStepCount: assemblySteps.length,
            assemblyStepLabels: assemblySteps.map(step => step.label),
            assemblyStepFingerprints: assemblySteps.map(assemblyStepFingerprint),
            layerCount: renderPlan.layers.length,
            stackSummary: renderPlan.stackSummary,
            roleSummary: renderPlan.roleSummary,
            validationErrors: fabricationValidationErrors
        }
    };
};

export const summarizeCompiledMechanism = (compiled: CompiledMechanism): MechanismGraphCompilerSummary => ({
    compilerSource: compiled.compilerSource,
    recipeCompilerSource: compiled.fabrication.recipeCompilerSource,
    irVersion: compiled.graph.version,
    graphId: compiled.graph.id,
    familyId: compiled.graph.family.id,
    firstCompilerTarget: compiled.graph.family.firstCompilerTarget,
    source: compiled.graph.source,
    solver: compiled.graph.solver,
    persisted: compiled.graph.persisted,
    nodeCount: compiled.graph.nodes.length,
    constraintCount: compiled.graph.constraints.length,
    driverCount: compiled.graph.drivers.length,
    diagnosticCount: compiled.graph.diagnostics.length + compiled.graphValidationDiagnostics.length,
    diagnostics: [...compiled.graph.diagnostics, ...compiled.graphValidationDiagnostics],
    connectionSelectionSummary: compiled.graph.connectionSelectionSummary,
    motionSampleCount: compiled.motionSamples.length,
    feasiblePercentValid: compiled.feasibleRange.percentValid,
    readinessErrorCount: compiled.readinessErrors.length,
    assemblyStepCount: compiled.fabrication.assemblyStepCount
});
