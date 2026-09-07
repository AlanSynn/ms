import type { BodyPartLayer, ProjectState, SceneObject } from '../types';
import type { PDFOperator } from 'pdf-lib';
import { artworkCanvasPng, disposeArtworkCanvas, rasterizeOwnerArtwork } from '../runtime/artwork/artworkRaster';
import { buildPlanSourceDigest, type BuildPlanV1 } from './buildPlan';
import { buildPlanArtworkSourceDigest, buildTargetArtworkRevision } from './buildPlanArtwork';
import {
    buildPlanCharacterPrintLayout,
    makeCharacterTemplatePdfPageContentsFromBuildPlan,
    type BuildPlanPrintPart,
} from './fabricationCustomParts';
import {
    buildPartLocalToPdf,
    buildPartPrintLocalHoles,
    buildPartPrintRasterFrame,
    buildPartPrintResolution,
    buildPartSceneToLocal,
    PAINT_PRINT_PPI,
} from './fabricationArtworkPlacement';
import { LETTER_PDF_PAGE, makePdfDocument, PDF_POINTS_PER_MM } from './simplePdf';

type PaintRasterRequest = Parameters<typeof rasterizeOwnerArtwork>[0];
export type PrintArtworkRasterizer = (request: PaintRasterRequest) => Promise<string>;

const rasterizePrintArtwork: PrintArtworkRasterizer = async request => {
    const canvas = await rasterizeOwnerArtwork(request);
    try { return await artworkCanvasPng(canvas); }
    finally { disposeArtworkCanvas(canvas); }
};

const assertActive = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Build canceled.', 'AbortError');
};

/** Generated from retained owner-local commands at physical print size, never a viewport. */
export const makePaintedPartsPdfFromBuildPlan = async (
    plan: BuildPlanV1,
    source: ProjectState,
    sourceProjectFingerprint: string,
    options: { signal?: AbortSignal; rasterize?: PrintArtworkRasterizer } = {},
) => {
    if (plan.sourceDigest !== buildPlanSourceDigest(source, plan.scope, plan.lane) ||
        plan.artworkSourceDigest !== buildPlanArtworkSourceDigest(source, plan.scope)) {
        throw new Error('Project changed. Build the current artwork again.');
    }
    assertActive(options.signal);
    const pdf = await import('pdf-lib');
    const document = await pdf.PDFDocument.create();
    const layout = buildPlanCharacterPrintLayout(plan);
    const overlayBytes = new TextEncoder().encode(makePdfDocument(
        makeCharacterTemplatePdfPageContentsFromBuildPlan(plan, sourceProjectFingerprint, { painted: true }),
    ));
    // embedPdf defaults to page 0; every packed sheet needs its own vector layer.
    const overlays = await document.embedPdf(overlayBytes, Array.from({ length: layout.pageCount }, (_, index) => index));
    const placementRecords: Array<Record<string, unknown>> = [];

    const pageClip = (item: BuildPlanPrintPart): PDFOperator[] => {
        const point = (p: { x: number; y: number }) => ({ x: p.x * PDF_POINTS_PER_MM, y: LETTER_PDF_PAGE.height - p.y * PDF_POINTS_PER_MM });
        const outline = item.outlineMm.map(point);
        const operations = [pdf.moveTo(outline[0].x, outline[0].y), ...outline.slice(1).map(p => pdf.lineTo(p.x, p.y)), pdf.closePath()];
        const r = layout.holeRadiusMm * PDF_POINTS_PER_MM;
        const k = r * 0.5522847498;
        for (const hole of item.holeMm) {
            const { x, y } = point(hole);
            operations.push(pdf.moveTo(x + r, y),
                pdf.appendBezierCurve(x + r, y + k, x + k, y + r, x, y + r),
                pdf.appendBezierCurve(x - k, y + r, x - r, y + k, x - r, y),
                pdf.appendBezierCurve(x - r, y - k, x - k, y - r, x, y - r),
                pdf.appendBezierCurve(x + k, y - r, x + r, y - k, x + r, y), pdf.closePath());
        }
        operations.push(pdf.clipEvenOdd(), pdf.endPath());
        return operations;
    };

    for (let pageIndex = 0; pageIndex < layout.pageCount; pageIndex += 1) {
        const page = document.addPage([LETTER_PDF_PAGE.width, LETTER_PDF_PAGE.height]);
        for (const item of layout.parts.filter(part => part.pageIndex === pageIndex)) {
            assertActive(options.signal);
            const reference = item.part.artwork;
            const owner: BodyPartLayer | SceneObject = reference.ownerKind === 'part'
                ? source.parts[reference.ownerId] : source.sceneObjects[reference.ownerId];
            if (!owner || buildTargetArtworkRevision(owner) !== reference.revision) {
                throw new Error(`${item.part.name}: artwork changed. Build again.`);
            }
            const targetFrame = buildPartPrintRasterFrame(item);
            const resolution = buildPartPrintResolution(item, targetFrame);
            const matrix = buildPartLocalToPdf(item);
            const png = await (options.rasterize ?? rasterizePrintArtwork)({
                owner, targetFrame,
                clip: {
                    kind: 'contour',
                    points: item.part.outline.map(point => buildPartSceneToLocal(item, point)),
                    holes: buildPartPrintLocalHoles(item, layout.holeRadiusMm),
                },
                resolution, baseColor: owner.fillColor, signal: options.signal,
            });
            assertActive(options.signal);
            const image = await document.embedPng(png);
            page.pushOperators(pdf.pushGraphicsState(), ...pageClip(item),
                pdf.concatTransformationMatrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f));
            page.drawImage(image, { x: targetFrame.x, y: targetFrame.y, width: targetFrame.width, height: targetFrame.height });
            page.pushOperators(pdf.popGraphicsState());
            placementRecords.push({ ownerKind: reference.ownerKind, ownerId: reference.ownerId, revision: reference.revision, pageIndex, localToPage: matrix, frame: targetFrame, resolution });
        }
        // Vector strokes, true physical holes and labels follow the artwork.
        page.drawPage(overlays[pageIndex], { x: 0, y: 0 });
    }
    document.setTitle(`${plan.projectName} / painted cut sheets`);
    document.setSubject(JSON.stringify({ sourceDigest: plan.sourceDigest, artworkSourceDigest: plan.artworkSourceDigest, sourceProjectFingerprint, ppi: PAINT_PRINT_PPI, frontSide: true }));
    assertActive(options.signal);
    return {
        pdf: await document.saveAsBase64({ dataUri: true }),
        placements: placementRecords,
        pageCount: layout.pageCount,
    };
};
