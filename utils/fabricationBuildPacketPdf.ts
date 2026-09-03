import type { BuildPlanV1 } from './buildPlan';
import { makeBlueprintPdfFromBuildPlan } from './fabricationBlueprintPdf';

/** Legacy compatibility wrapper. Character and tutorial pages are intentionally excluded. */
export const makeBuildPacketPdfFromBuildPlan = (
    plan: BuildPlanV1,
    _characterPlan?: BuildPlanV1,
    _sourceProjectFingerprint?: string
) => makeBlueprintPdfFromBuildPlan(plan);
