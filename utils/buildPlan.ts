import type { FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { fabricationPartDisplayLabel } from './fabricationContract';
import { createFabricationRecipe, mechanismTypeLabel } from './fabricationRecipes';
import { buildCharacterBuildSectionV1 } from './buildPlanCharacter';
import { buildMechanismBuildStepsV1, buildPlanLaneForExportMode } from './buildPlanSteps';
import { buildMechanismGeometryV1, buildPlanMotionPathsV1 } from './buildPlanGeometry';
import { buildPlanArtworkSourceDigest } from './buildPlanArtwork';
import { buildObjectBuildSectionV1 } from './buildPlanObjects';
import {
    BUILD_PLAN_SCHEMA_V1,
    type BuildPlanLaneV1,
    type BuildPlanMechanismV1,
    type BuildPlanPartV1,
    type BuildPlanScopeV1,
    type BuildPlanV1
} from './buildPlanTypes';

export * from './buildPlanTypes';
export { buildPlanArtworkSourceDigest } from './buildPlanArtwork';
export { buildPlanLaneForExportMode } from './buildPlanSteps';

export type BuildPlanOptionsV1 = {
    scope?: BuildPlanScopeV1;
    lane?: BuildPlanLaneV1;
    recipes?: readonly FabricationRecipe[];
    warnings?: readonly string[];
    includeDetachedRecipes?: boolean;
};

const stableJsonValue = (value: unknown): unknown => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(item => stableJsonValue(item));
    if (typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((result, key) => {
                const item = (value as Record<string, unknown>)[key];
                if (item !== undefined && typeof item !== 'function' && typeof item !== 'symbol') {
                    result[key] = stableJsonValue(item);
                }
                return result;
            }, {});
    }
    return String(value);
};

export const stableBuildPlanJson = (value: unknown) => JSON.stringify(stableJsonValue(value));

const cloneSerializable = <T>(value: T): T => JSON.parse(stableBuildPlanJson(value)) as T;

const fnv1a32 = (value: string) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const activeMechanismsForBuild = (project: ProjectState) =>
    project.mechanisms.filter(mechanism => mechanism.visible && mechanism.enabled !== false);

const buildSourceProjection = (
    project: ProjectState,
    scope: BuildPlanScopeV1,
    lane: BuildPlanLaneV1
) => {
    const parts = Object.fromEntries(project.partOrder.flatMap(id => {
        const part = project.parts[id];
        if (!part) return [];
        const {
            textureUrl: _textureUrl,
            maskUrl: _maskUrl,
            originalSvgPath: _originalSvgPath,
            enhancedSvgPath: _enhancedSvgPath,
            artwork: _artwork,
            fillColor: _fillColor,
            sourceImageFrame: _sourceImageFrame,
            ...buildPart
        } = part;
        return [[id, buildPart]];
    }));
    const sceneObjects = scope === 'complete'
        ? Object.fromEntries(project.sceneObjectOrder.flatMap(id => {
            const sceneObject = project.sceneObjects[id];
            if (!sceneObject) return [];
            const { textureUrl: _textureUrl, artwork: _artwork, fillColor: _fillColor, ...buildObject } = sceneObject;
            return [[id, buildObject]];
        }))
        : {};
    const mechanisms = scope === 'complete'
        ? activeMechanismsForBuild(project).map(mechanism => {
            const { foundryExport: _foundryExport, ...buildMechanism } = mechanism;
            return buildMechanism;
        })
        : [];
    return {
        scope,
        lane,
        projectVersion: project.version,
        metadata: {
            id: project.metadata.id,
            name: project.metadata.name,
            normalizationScale: project.metadata.normalizationScale
        },
        profile: project.settings.physicalKit,
        partOrder: project.partOrder,
        parts,
        skeleton: project.skeleton,
        sceneObjectOrder: scope === 'complete' ? project.sceneObjectOrder : [],
        sceneObjects,
        paths: scope === 'complete' ? project.paths : {},
        mechanisms,
        recipes: scope === 'complete'
            ? activeMechanismsForBuild(project).map(mechanism => createFabricationRecipe(project, mechanism))
            : []
    };
};

export const buildPlanSourceDigest = (
    project: ProjectState,
    scope: BuildPlanScopeV1 = 'complete',
    lane: BuildPlanLaneV1 = buildPlanLaneForExportMode(project.settings.physicalKit.exportMode)
) => `fnv1a32:${fnv1a32(stableBuildPlanJson(buildSourceProjection(project, scope, lane)))}`;

const stableMechanismRef = (mechanismId: string) => `mechanism:${encodeURIComponent(mechanismId)}`;

const stablePartSegment = (value: string) => encodeURIComponent(
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part'
);

const mechanismParts = (recipe: FabricationRecipe, mechanismRef: string): BuildPlanPartV1[] =>
    recipe.requiredParts.map((part, index) => ({
        ref: `${mechanismRef}:part:${stablePartSegment(part.key ?? part.name)}:${index + 1}`,
        kind: 'mechanism',
        mechanismId: recipe.mechanismId,
        name: part.name,
        displayName: fabricationPartDisplayLabel(part.name),
        quantity: part.quantity,
        category: part.category,
        key: part.key
    }));

const uniqueStrings = (values: readonly string[]) => [...new Set(values.filter(Boolean))];

export const createBuildPlanV1 = (
    project: ProjectState,
    options: BuildPlanOptionsV1 = {}
): BuildPlanV1 => {
    const scope = options.scope ?? 'complete';
    const lane = options.lane ?? buildPlanLaneForExportMode(project.settings.physicalKit.exportMode);
    const characterBuild = buildCharacterBuildSectionV1(project);
    const objectBuild = buildObjectBuildSectionV1(scope === 'complete' ? project : { ...project, sceneObjectOrder: [] });
    const providedRecipes = [...(options.recipes ?? [])];
    const providedByMechanismId = new Map<string, FabricationRecipe>();
    for (const recipe of providedRecipes) {
        if (!providedByMechanismId.has(recipe.mechanismId)) providedByMechanismId.set(recipe.mechanismId, recipe);
    }

    const activeMechanisms = scope === 'complete' ? activeMechanismsForBuild(project) : [];
    const activeIds = new Set(activeMechanisms.map(mechanism => mechanism.id));
    const candidates: Array<{ mechanism?: MechanismConfig; recipe: FabricationRecipe }> = activeMechanisms.map(mechanism => ({
        mechanism,
        recipe: providedByMechanismId.get(mechanism.id) ?? createFabricationRecipe(project, mechanism)
    }));
    if (scope === 'complete' && options.includeDetachedRecipes) {
        providedRecipes
            .filter(recipe => !activeIds.has(recipe.mechanismId))
            .sort((a, b) => a.mechanismId.localeCompare(b.mechanismId))
            .forEach(recipe => candidates.push({
                mechanism: project.mechanisms.find(mechanism => mechanism.id === recipe.mechanismId),
                recipe
            }));
    }

    let nextOrder = 1;
    const characterSteps = characterBuild.steps.map(step => ({ ...step, order: nextOrder++ }));
    const objectSteps = objectBuild.steps.map(step => ({ ...step, order: nextOrder++ }));
    const allParts: BuildPlanPartV1[] = [...characterBuild.parts, ...objectBuild.parts];
    const allSteps = [...characterSteps, ...objectSteps];
    const mechanisms: BuildPlanMechanismV1[] = [];
    const mechanismSections = [] as BuildPlanV1['sections'];

    for (const candidate of candidates) {
        const recipe = cloneSerializable(candidate.recipe);
        const mechanismRef = stableMechanismRef(recipe.mechanismId);
        const parts = mechanismParts(recipe, mechanismRef);
        const steps = buildMechanismBuildStepsV1(recipe, lane, mechanismRef, parts)
            .map(step => ({ ...step, order: nextOrder++ }));
        const partRefs = parts.map(part => part.ref);
        const stepIds = steps.map(step => step.id);
        const section = {
            id: mechanismRef,
            kind: 'mechanism' as const,
            label: `${recipe.mechanismId} / ${mechanismTypeLabel(recipe.type)}`,
            mechanismId: recipe.mechanismId,
            mechanismRef,
            partRefs,
            stepIds
        };
        mechanisms.push({
            ref: mechanismRef,
            sectionId: section.id,
            sourceMechanismId: recipe.mechanismId,
            label: section.label,
            mechanism: candidate.mechanism ? cloneSerializable(candidate.mechanism) : undefined,
            recipe,
            geometry: buildMechanismGeometryV1(candidate.mechanism, recipe, project.settings.physicalKit, partRefs),
            partRefs,
            stepIds
        });
        mechanismSections.push(section);
        allParts.push(...parts);
        allSteps.push(...steps);
    }

    const warnings = uniqueStrings([
        ...(options.warnings ?? []),
        ...mechanisms.flatMap(mechanism => mechanism.recipe.warnings)
    ]);
    const plan: BuildPlanV1 = {
        schema: BUILD_PLAN_SCHEMA_V1,
        version: 1,
        scope,
        lane,
        sourceDigest: buildPlanSourceDigest(project, scope, lane),
        artworkSourceDigest: buildPlanArtworkSourceDigest(project, scope),
        source: { projectId: project.metadata.id, projectVersion: project.version },
        projectName: project.metadata.name,
        profile: cloneSerializable(project.settings.physicalKit),
        warnings,
        parts: allParts,
        character: {
            ...characterBuild.character,
            stepIds: characterSteps.map(step => step.id)
        },
        objects: objectBuild.objects,
        motions: scope === 'complete' ? buildPlanMotionPathsV1(project, mechanisms) : [],
        mechanisms,
        sections: [
            { ...characterBuild.section, stepIds: characterSteps.map(step => step.id) },
            ...(objectBuild.parts.length ? [{ ...objectBuild.section, stepIds: objectSteps.map(step => step.id) }] : []),
            ...mechanismSections
        ],
        steps: allSteps
    };
    return cloneSerializable(plan);
};

export const createCharacterBuildPlanV1 = (
    project: ProjectState,
    options: Omit<BuildPlanOptionsV1, 'scope' | 'recipes' | 'includeDetachedRecipes'> = {}
) => createBuildPlanV1(project, { ...options, scope: 'character' });

export const buildPlanFromProject = createBuildPlanV1;
export const createBuildPlan = createBuildPlanV1;

export const buildPlanSectionSteps = (plan: BuildPlanV1, sectionId: string) => {
    const stepIds = new Set(plan.sections.find(section => section.id === sectionId)?.stepIds ?? []);
    return plan.steps.filter(step => stepIds.has(step.id));
};
