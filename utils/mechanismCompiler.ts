import type { FabricationRecipe, MechanismConfig, PhysicalKitSettings, ProjectState } from '../types';
import { sampleFeasibleRange, type FabricationFeasibleRange } from './fabricationReadiness';
import { createFabricationRecipe, prefabAssemblySteps } from './fabricationRecipes';
import { fabricationRenderPlanForMechanism, type FabricationRenderPlan } from './fabricationRenderPlan';
import { assemblyStepFingerprint, type AssemblyStepFingerprint } from './fabricationAssemblyFingerprint';
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
import { validateMechanismPreviewReadiness } from './mechanismPreviewReadiness';

export type CompiledAssemblyStepFingerprint = AssemblyStepFingerprint;

export type MechanismCompilerSource = 'mechanismCompiler';
export type MechanismRecipeCompilerSource = 'compileFabricationRecipe' | 'compileGraphFabricationRecipe';

export type CompiledMechanism = {
    compilerSource: MechanismCompilerSource;
    graph: MechanismGraph;
    graphValidationDiagnostics: MechanismGraphDiagnostic[];
    motionSamples: MechanismGraphMotionSample[];
    feasibleRange: FabricationFeasibleRange;
    readinessErrors: string[];
    fabrication: {
        renderPlan: FabricationRenderPlan;
        renderPlanSource: 'compileMechanismRenderPlan';
        assemblyPlanSource: 'prefabAssemblySteps';
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

export const compileFabricationRecipe = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe =>
    createFabricationRecipe(project, mechanism);

export const compileMechanismRenderPlan = (mechanism: MechanismConfig): FabricationRenderPlan =>
    fabricationRenderPlanForMechanism(mechanism);

export const compileAuthoredMechanismGraph = (graph: MechanismGraph, kit?: PhysicalKitSettings): AuthoredGraphCompilation => {
    const validation = validateMechanismGraph(graph);
    const fabrication = compileGraphFabricationRecipe(graph, kit);
    const fabricationBlockers = fabrication.buildable ? [] : [fabrication.blocker ?? 'Recipe missing'];
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
    feasibleSamples = 24
): CompiledMechanism => {
    const graph = mechanismGraphForMechanism(mechanism);
    const graphValidation = validateMechanismGraph(graph);
    const renderPlan = compileMechanismRenderPlan(mechanism);
    const assemblyBoardCoordinate = mechanism.fabricationMetadata?.boardCoordinate ?? 'H8';
    const assemblySteps = prefabAssemblySteps(mechanism, assemblyBoardCoordinate);
    return {
        compilerSource: 'mechanismCompiler',
        graph,
        graphValidationDiagnostics: graphValidation.diagnostics,
        motionSamples: angles.map(angle => sampleMechanismGraphMotion(mechanism, angle)),
        feasibleRange: sampleFeasibleRange(mechanism, feasibleSamples),
        readinessErrors: validateMechanismPreviewReadiness(mechanism),
        fabrication: {
            renderPlan,
            renderPlanSource: 'compileMechanismRenderPlan',
            assemblyPlanSource: 'prefabAssemblySteps',
            recipeCompilerSource: 'compileFabricationRecipe',
            assemblyBoardCoordinate,
            assemblyStepCount: assemblySteps.length,
            assemblyStepLabels: assemblySteps.map(step => step.label),
            assemblyStepFingerprints: assemblySteps.map(assemblyStepFingerprint),
            layerCount: renderPlan.layers.length,
            stackSummary: renderPlan.stackSummary,
            roleSummary: renderPlan.roleSummary,
            validationErrors: renderPlan.validationErrors
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
    motionSampleCount: compiled.motionSamples.length,
    feasiblePercentValid: compiled.feasibleRange.percentValid,
    readinessErrorCount: compiled.readinessErrors.length,
    assemblyStepCount: compiled.fabrication.assemblyStepCount
});
