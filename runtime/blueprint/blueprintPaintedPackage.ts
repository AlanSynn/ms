import type { FabricationPackage, ProjectState } from '../../types';
import { buildPlanSourceDigest, type BuildPlanV1 } from '../../utils/buildPlan';
import { buildPlanArtworkSourceDigest, buildTargetArtworkReference } from '../../utils/buildPlanArtwork';
import { makePaintedPartsPdfFromBuildPlan, type PrintArtworkRasterizer } from '../../utils/paintedPartsPdf';
import { mergeBuildPacketPdfs } from '../../utils/fabricationBuildPacketPdf';
import { projectContentFingerprint } from '../../utils/projectSerialization';
import { makeBuildPlanCutSvg } from '../../utils/buildPlanCutSvg';

export const restoreBuildPlanArtwork = (plan: BuildPlanV1, source: ProjectState): BuildPlanV1 => {
    if (plan.sourceDigest !== buildPlanSourceDigest(source, plan.scope, plan.lane)) {
        throw new Error('Project changed. Build the current artwork again.');
    }
    return {
        ...plan,
        artworkSourceDigest: buildPlanArtworkSourceDigest(source, plan.scope),
        character: {
            ...plan.character,
            parts: plan.character.parts.map(part => {
                const owner = source.parts[part.sourcePartId];
                if (!owner) throw new Error(`${part.name}: part is missing. Build again.`);
                return { ...part, fillColor: owner.fillColor, artwork: buildTargetArtworkReference(owner, 'part') };
            }),
        },
        objects: {
            ...plan.objects,
            parts: (plan.objects?.parts ?? []).map(part => {
                const owner = source.sceneObjects[part.sourceSceneObjectId];
                if (!owner) throw new Error(`${part.name}: object is missing. Build again.`);
                return { ...part, fillColor: owner.fillColor, artwork: buildTargetArtworkReference(owner, 'scene-object') };
            }),
        },
    };
};

/** Finalize the geometry worker's captured revision with its own source artwork. */
export const createPaintedBlueprintPackage = async (
    geometry: FabricationPackage,
    source: ProjectState,
    options: { signal?: AbortSignal; rasterize?: PrintArtworkRasterizer } = {},
): Promise<FabricationPackage> => {
    const fingerprint = projectContentFingerprint(source);
    if (geometry.sourceProjectFingerprint !== fingerprint || !geometry.buildPlanJson) {
        throw new Error('Project changed. Build the current artwork again.');
    }
    const plan = restoreBuildPlanArtwork(JSON.parse(geometry.buildPlanJson) as BuildPlanV1, source);
    const metadata = JSON.parse(geometry.metadataJson);
    const characterPlan = metadata.characterBuildPlan
        ? restoreBuildPlanArtwork(metadata.characterBuildPlan as BuildPlanV1, source) : undefined;
    const painted = await makePaintedPartsPdfFromBuildPlan(plan, source, fingerprint, options);
    const pdfOptions = { signal: options.signal, subject: JSON.stringify({
        sourceDigest: plan.sourceDigest, artworkSourceDigest: plan.artworkSourceDigest,
        sourceProjectFingerprint: fingerprint, ppi: 300, frontSide: true,
    }) };
    const buildPacketPdf = await mergeBuildPacketPdfs([
        painted.pdf,
        plan.mechanisms.length ? geometry.blueprintPdf ?? geometry.cutSheetPdf : '',
        geometry.assemblyGuidePdf,
    ], `${source.metadata.name} / build packet`, pdfOptions);
    const assemblyGuidePdf = await mergeBuildPacketPdfs([
        painted.pdf, geometry.assemblyGuidePdf,
    ], `${source.metadata.name} / assembly`, pdfOptions);
    if (options.signal?.aborted) throw new DOMException('Build canceled.', 'AbortError');
    if (fingerprint !== projectContentFingerprint(source)) {
        throw new Error('Project changed. Build the current artwork again.');
    }
    return {
        ...geometry,
        buildPlanJson: JSON.stringify(plan),
        buildPlanArtworkSourceDigest: plan.artworkSourceDigest,
        customPartsPdf: painted.pdf,
        customPartsSvg: makeBuildPlanCutSvg(plan),
        buildPacketPdf,
        assemblyGuidePdf,
        metadataJson: JSON.stringify({
            ...metadata,
            buildPlan: plan,
            ...(characterPlan ? { characterBuildPlan: characterPlan, characterBuildPlanArtworkSourceDigest: characterPlan.artworkSourceDigest } : {}),
            buildPlanArtworkSourceDigest: plan.artworkSourceDigest,
            artworkPrint: { ppi: 300, frontSide: true, pageCount: painted.pageCount, placements: painted.placements },
        }),
    };
};
