import type {
  FabricationPackage,
  FabricationRecipe,
  ProjectState,
} from '../../types';
import { pendingRecipeForMechanism } from '../../utils/assemblyPlayback';
import { createBuildPlanV1, type BuildPlanV1 } from '../../utils/buildPlan';
import {
  createFabricationPackage,
  validateForFabrication,
} from '../../utils/fabrication';

export type BlueprintModel = {
  validation: ReturnType<typeof validateForFabrication>;
  pkg?: FabricationPackage;
  recipes: FabricationRecipe[];
  buildPlan: BuildPlanV1;
};

const modelCache = new WeakMap<ProjectState, BlueprintModel>();
const packageCache = new WeakMap<ProjectState, FabricationPackage>();

export const buildBlueprintModel = (project: ProjectState): BlueprintModel => {
  const cached = modelCache.get(project);
  if (cached) return cached;

  const validation = validateForFabrication(project);
  const pkg = project.lastExport;
  const activeMechanisms = project.mechanisms.filter(
    (mechanism) => mechanism.visible && mechanism.enabled !== false,
  );
  const liveRecipes = activeMechanisms.map((mechanism) =>
    pendingRecipeForMechanism(project, mechanism),
  );
  const recipes = liveRecipes.length ? liveRecipes : (pkg?.recipes ?? []);
  const buildPlan = createBuildPlanV1(project, {
    recipes,
    includeDetachedRecipes: !liveRecipes.length && recipes.length > 0,
  });
  const model = {
    validation,
    pkg,
    recipes,
    buildPlan,
  };
  modelCache.set(project, model);
  return model;
};

export const createBlueprintPackage = (
  project: ProjectState,
): FabricationPackage => {
  const cached = packageCache.get(project);
  if (cached) return cached;
  const pkg = createFabricationPackage(project);
  packageCache.set(project, pkg);
  return pkg;
};
