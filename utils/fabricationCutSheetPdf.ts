import type { FabricationRecipe, ProjectState } from '../types';
import { createBuildPlanV1, type BuildPlanV1 } from './buildPlan';
import { makeBlueprintPdfFromBuildPlan, makeBlueprintPdfPageContentsFromBuildPlan } from './fabricationBlueprintPdf';

/** Compatibility names for callers that have not yet adopted Blueprint terminology. */
export const makeCutSheetPdfPageContentsFromBuildPlan = (plan: BuildPlanV1) =>
    makeBlueprintPdfPageContentsFromBuildPlan(plan);

export const makeCutSheetPdfFromBuildPlan = (plan: BuildPlanV1) =>
    makeBlueprintPdfFromBuildPlan(plan);

export const makeCutSheetPdf = (project: ProjectState, recipes: FabricationRecipe[]) =>
    makeCutSheetPdfFromBuildPlan(createBuildPlanV1(project, { recipes }));
