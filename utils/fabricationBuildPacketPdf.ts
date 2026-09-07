import type { BuildPlanV1 } from './buildPlan';
import { makeBlueprintPdfFromBuildPlan } from './fabricationBlueprintPdf';
import { pdfBytes } from './pdfDownload';

/** Legacy compatibility wrapper. Character and tutorial pages are intentionally excluded. */
export const makeBuildPacketPdfFromBuildPlan = (
    plan: BuildPlanV1,
    _characterPlan?: BuildPlanV1,
    _sourceProjectFingerprint?: string
) => makeBlueprintPdfFromBuildPlan(plan);

/** Copy complete page resource trees; image XObjects cannot be merged as content strings. */
export const mergeBuildPacketPdfs = async (sources: readonly string[], title: string, options: { signal?: AbortSignal; subject?: string } = {}) => {
    const { PDFDocument } = await import('pdf-lib');
    const packet = await PDFDocument.create();
    for (const source of sources.filter(Boolean)) {
        if (options.signal?.aborted) throw new DOMException('Build canceled.', 'AbortError');
        const document = await PDFDocument.load(pdfBytes(source));
        const pages = await packet.copyPages(document, document.getPageIndices());
        pages.forEach(page => packet.addPage(page));
    }
    if (options.signal?.aborted) throw new DOMException('Build canceled.', 'AbortError');
    packet.setTitle(title);
    if (options.subject) packet.setSubject(options.subject);
    return packet.saveAsBase64({ dataUri: true });
};
