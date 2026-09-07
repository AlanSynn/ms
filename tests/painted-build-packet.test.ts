import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { createFabricationReadyFourBarProject } from './fixtures/fabricationProject';
import { appendArtworkOperation, artworkForOwner, ownerLocalToScene } from '../utils/artwork';
import { buildPlanArtworkSourceDigest, buildPlanSourceDigest, createBuildPlanV1 } from '../utils/buildPlan';
import { buildPlanCharacterPrintLayout, makeCharacterTemplatePdfPageContentsFromBuildPlan } from '../utils/fabricationCustomParts';
import { buildPartLocalToPdf, buildPartPrintLocalHoles, buildPartPrintRasterFrame, buildPartPrintResolution, transformPdfPoint } from '../utils/fabricationArtworkPlacement';
import { makePaintedPartsPdfFromBuildPlan } from '../utils/paintedPartsPdf';
import { mergeBuildPacketPdfs } from '../utils/fabricationBuildPacketPdf';
import { makeBlueprintPdfFromBuildPlan } from '../utils/fabricationBlueprintPdf';
import { projectContentFingerprint } from '../utils/projectSerialization';
import { pdfBytes } from '../utils/pdfDownload';
import { PDF_POINTS_PER_MM } from '../utils/simplePdf';
import { blueprintPackageWithoutSceneArtwork, restoreBlueprintPackageSceneArtwork } from '../runtime/blueprint/blueprintPackageTransfer';
import { createCharacterTemplateArtifact, createFabricationPackage, validateForFabrication } from '../utils/fabrication';
import { createDefaultSceneObject, createEmptyProject, createLessonProject } from '../utils/project';
import { makeBuildPlanCutSvg } from '../utils/buildPlanCutSvg';
import { prepareAssemblyGuideModel } from '../components/stages/assembly/assemblyGuideModel';
import { buildCharacterAssemblySceneFrame } from '../utils/assemblySceneFrame';
import { createPaintedBlueprintPackage } from '../runtime/blueprint/blueprintPaintedPackage';
import { SCENE_PX_PER_MM } from '../utils/coordinates';
import { buildPlanPreviewFrame } from '../utils/buildPlanPreviewFrame';
import { buildBlueprintModel } from '../runtime/blueprint/BlueprintModel';

const base = createFabricationReadyFourBarProject();
const id = base.partOrder[0];
const owner = base.parts[id];
const paintedOwner = { ...owner, artwork: appendArtworkOperation(artworkForOwner(owner), {
    id: 'paint-face', kind: 'brush', width: 8, color: '#cf2459', points: [{ x: -4, y: 8 }, { x: 12, y: 8 }],
}) };
const painted = { ...base, parts: { ...base.parts, [id]: paintedOwner } };
assert.equal(buildPlanSourceDigest(painted), buildPlanSourceDigest(base), 'a retained paint gesture cannot invalidate physical fitting geometry');
assert.notEqual(buildPlanArtworkSourceDigest(painted), buildPlanArtworkSourceDigest(base), 'a paint gesture invalidates painted outputs');
const recolored = { ...painted, parts: { ...painted.parts, [id]: { ...paintedOwner, fillColor: '#24b5a0' } } };
assert.equal(buildPlanSourceDigest(recolored), buildPlanSourceDigest(painted), 'substrate color is independent of geometry');
assert.notEqual(buildPlanArtworkSourceDigest(recolored), buildPlanArtworkSourceDigest(painted), 'substrate color invalidates painted output');

const transformed = { ...painted, parts: { ...painted.parts, [id]: { ...paintedOwner, transform: { x: 44, y: -31, rotation: 37, scale: 1.35 } } } };
const transformedPlan = createBuildPlanV1(transformed);
const item = buildPlanCharacterPrintLayout(transformedPlan).parts.find(part => part.part.id === id)!;
const matrix = buildPartLocalToPdf(item);
const local = { x: 6, y: 11 };
const scene = ownerLocalToScene(local, transformed.parts[id].transform);
const pdf = transformPdfPoint(matrix, local);
assert(Math.abs(pdf.x - (item.sceneToPageMm.x + scene.x * item.sceneToPageMm.scale) * PDF_POINTS_PER_MM) < 1e-9);
assert(Math.abs(pdf.y - (792 - (item.sceneToPageMm.y - scene.y * item.sceneToPageMm.scale) * PDF_POINTS_PER_MM)) < 1e-9,
    'art shares the contour scene-to-page transform, including scene/PDF Y-up and rotation');
const frame = buildPartPrintRasterFrame(item);
const resolution = buildPartPrintResolution(item, frame);
assert(resolution.width >= frame.width * Math.hypot(matrix.a, matrix.b) * 300 / 72);
assert(resolution.width < frame.width * Math.hypot(matrix.a, matrix.b) * 300 / 72 + 1);
assert.throws(() => buildPartPrintResolution(item, { ...frame, width: 1e7 }), /300 ppi print limit/);
assert.equal(item.part.artwork.ownerId, id);
assert.deepEqual(item.part.artwork.frame, paintedOwner.artwork.frame, 'moving/scaling the piece does not redefine the retained art frame');
const localHoles = buildPartPrintLocalHoles(item, transformedPlan.profile.holeDiameterMm / 2);
localHoles.forEach((hole, index) => {
    const mapped = transformPdfPoint(matrix, hole.center);
    assert(Math.abs(mapped.x - item.holeMm[index].x * PDF_POINTS_PER_MM) < 1e-9);
    assert(Math.abs(mapped.y - (792 - item.holeMm[index].y * PDF_POINTS_PER_MM)) < 1e-9);
    assert(Math.abs(hole.radius * Math.hypot(matrix.a, matrix.b) - transformedPlan.profile.holeDiameterMm / 2 * PDF_POINTS_PER_MM) < 1e-9,
        'raster clipping and PDF vector holes retain the same kit diameter under owner scale/rotation');
});

const plan = createBuildPlanV1(painted);
// A tiny RGBA test input exercises binary image/resource transport. The browser
// test separately proves compositor pixels at the requested physical resolution.
const rgbaPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwHwyBNBAwMAAARssH+dQXp8kAAAAASUVORK5CYII=';
const requestedOwners: string[] = [];
const result = await makePaintedPartsPdfFromBuildPlan(plan, painted, projectContentFingerprint(painted), {
    rasterize: async request => { requestedOwners.push(request.owner.artwork?.revision ?? 'base'); return rgbaPng; },
});
assert.equal(requestedOwners.length, plan.character.parts.length);
assert(result.placements.some(record => record.ownerId === id));
const imageCount = (document: PDFDocument) => document.context.enumerateIndirectObjects().filter(([, object]) =>
    object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
).length;
const artDocument = await PDFDocument.load(pdfBytes(result.pdf));
assert(imageCount(artDocument) >= plan.character.parts.length, 'painted pages contain genuine image XObjects, including alpha masks');
assert.equal(artDocument.getPageCount(), result.pageCount);
assert.deepEqual(artDocument.getPages()[0].getSize(), { width: 612, height: 792 });
const packet = await mergeBuildPacketPdfs([result.pdf, makeBlueprintPdfFromBuildPlan(plan)], 'Painted packet');
const packetDocument = await PDFDocument.load(pdfBytes(packet));
assert.equal(imageCount(packetDocument), imageCount(artDocument), 'copyPages retains the entire image resource tree in the combined packet');
assert.equal(packetDocument.getPageCount(), artDocument.getPageCount() + plan.mechanisms.length);
assert.deepEqual(packetDocument.getPages().at(-1)!.getSize(), { width: 864, height: 864 }, 'native-size mechanism sheets keep their own physical MediaBox');
await assert.rejects(() => makePaintedPartsPdfFromBuildPlan(plan, recolored, projectContentFingerprint(recolored)), /Project changed/);

const geometry = blueprintPackageWithoutSceneArtwork(createFabricationPackage(painted));
const restored = restoreBlueprintPackageSceneArtwork(geometry, painted);
assert.equal(restored.sceneSnapshot.parts[id].artwork, paintedOwner.artwork, 'only the captured source revision is reattached');
assert.throws(() => restoreBlueprintPackageSceneArtwork(geometry, recolored), /Project changed/, 'new art cannot be attached to an older source packet');
const abort = new AbortController();
await assert.rejects(() => makePaintedPartsPdfFromBuildPlan(plan, painted, projectContentFingerprint(painted), {
    signal: abort.signal,
    rasterize: async () => { abort.abort(); return rgbaPng; },
}), /Build canceled/);
assert.equal(painted.parts[id].artwork, paintedOwner.artwork, 'canceled generation preserves retained project painting');

const lesson = createLessonProject('waving-arm');
const lessonHead = lesson.parts.head;
assert.notEqual(lessonHead.contourSource, 'user', 'fixture exercises the actual retained guided head outline');
const lessonHeadArtwork = appendArtworkOperation(artworkForOwner(lessonHead), {
    id: 'guided-face-detail', kind: 'line', from: { x: -8, y: 4 }, to: { x: 8, y: 4 }, width: 3, color: '#263d7c',
});
const paintedLesson = { ...lesson, parts: { ...lesson.parts, head: { ...lessonHead, artwork: lessonHeadArtwork } } };
assert.deepEqual(validateForFabrication(paintedLesson).errors, [], 'painting the existing guided head must not reclassify or block its original contour');
const cleanArtifact = createCharacterTemplateArtifact(paintedLesson);
assert(cleanArtifact.characterTemplatePdf.startsWith('%PDF'), 'separate clean outline printing still accepts the guided head');
assert((await PDFDocument.load(pdfBytes(cleanArtifact.characterTemplatePdf))).getSubject()?.includes(cleanArtifact.buildPlanSourceDigest), 'clean PDF provenance is stored in document metadata');
const crossedContour = [{ x: -20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }, { x: 20, y: -20 }];
const invalidUserLesson = { ...paintedLesson, parts: { ...paintedLesson.parts,
    head: { ...paintedLesson.parts.head, contourSource: 'user' as const, contourPoints: crossedContour },
} };
assert(validateForFabrication(invalidUserLesson).errors.some(error => error.includes('Uncross the outline.')));
assert.throws(() => createFabricationPackage(invalidUserLesson), /Uncross the outline/, 'the full packet rejects an invalid explicit contour instead of dropping or repairing that piece');
assert.throws(() => createCharacterTemplateArtifact(invalidUserLesson), /Uncross the outline/, 'clean outlines enforce the same explicit user contour blocker');
assert.equal(invalidUserLesson.parts.head.contourPoints, crossedContour);
assert.equal(invalidUserLesson.parts.head.artwork, lessonHeadArtwork, 'a rejected physical outline leaves its retained paint source intact');

const object = {
    ...createDefaultSceneObject('block', 'student-prop'),
    name: 'Painted rocket', fabrication: 'cuttable' as const,
    contourPoints: [{ x: -30, y: -20 }, { x: 10, y: -20 }, { x: 35, y: 0 }, { x: 10, y: 20 }, { x: -30, y: 20 }],
    transform: { x: 80, y: -90, rotation: -23, scale: 1.25 },
};
const paintedObject = { ...object, artwork: appendArtworkOperation(artworkForOwner(object), {
    id: 'rocket-window', kind: 'ellipse', from: { x: -12, y: -9 }, to: { x: 6, y: 9 }, color: '#2372b8',
}) };
const propOnly = {
    ...createEmptyProject(),
    sceneObjects: { [object.id]: paintedObject }, sceneObjectOrder: [object.id],
};
assert.equal(validateForFabrication(propOnly).errors.length, 0, 'an unattached cuttable prop can print before a mechanism exists');
const propBlueprint = buildBlueprintModel(propOnly);
assert.deepEqual(propBlueprint.validation.errors, [], 'the Blueprint adapter accepts a piece authored from the actual blank project');
assert.equal(propBlueprint.buildPlan.objects.parts.length, 1);
assert.equal(propBlueprint.buildPlan.character.parts.length, 0);
assert.deepEqual(propBlueprint.recipes, [], 'object-only Blueprint creates no placeholder mechanism');
const crossedProp = { ...propOnly, sceneObjects: { [object.id]: { ...paintedObject, contourPoints: crossedContour } } };
assert(validateForFabrication(crossedProp).errors.some(error => error.includes(paintedObject.name)), 'invalid cuttable props identify the blocked piece');
assert.throws(() => createFabricationPackage(crossedProp), /Painted rocket/, 'a cuttable prop cannot disappear silently from its packet');
const propPlan = createBuildPlanV1(propOnly);
const movedPropProject = { ...propOnly, sceneObjects: { [object.id]: {
    ...paintedObject, transform: { ...paintedObject.transform, x: 500, y: -350 },
} } };
const movedPropPlan = createBuildPlanV1(movedPropProject);
const movedPreviewFrame = buildPlanPreviewFrame(movedPropPlan);
const inPreview = (x: number, y: number) => x >= movedPreviewFrame.x && y >= movedPreviewFrame.y
    && x <= movedPreviewFrame.x + movedPreviewFrame.width && y <= movedPreviewFrame.y + movedPreviewFrame.height;
assert(movedPropPlan.objects.parts[0].outline.every(point => inPreview(point.x / SCENE_PX_PER_MM, -point.y / SCENE_PX_PER_MM)),
    'a moved and rotated cuttable prop stays visible outside the real board');
const boardHalf = movedPropPlan.profile.boardCells * movedPropPlan.profile.gridPitchMm / 2;
assert(inPreview(-boardHalf, -boardHalf) && inPreview(boardHalf, boardHalf), 'fitting the pieces also retains the real board');
const originalPrintedProp = buildPlanCharacterPrintLayout(propPlan).parts[0].outlineMm;
assert(buildPlanCharacterPrintLayout(movedPropPlan).parts[0].outlineMm.every((point, index) =>
    Math.abs(point.x - originalPrintedProp[index].x) < 1e-9 && Math.abs(point.y - originalPrintedProp[index].y) < 1e-9),
    'inspection framing does not resize the physical print');
assert.equal(propPlan.character.parts.length, 0);
assert.equal(propPlan.objects.parts[0].sourceSceneObjectId, object.id);
assert.deepEqual(propPlan.steps.map(step => step.phase), ['cut-object', 'place-object']);
assert(propPlan.steps.every(step => step.pinIds.length === 0 && step.stack.length === 0 && step.coords.length === 0), 'prop placement invents neither attachments nor hardware');
assert.deepEqual(buildPlanCharacterPrintLayout(propPlan).parts[0].holeMm, [], 'painted window is not a drilled hole');
const cutSvg = makeBuildPlanCutSvg(propPlan);
assert(cutSvg.includes('data-owner-id="student-prop"'));
assert(!cutSvg.includes('rocket-window') && !cutSvg.includes('<image') && !cutSvg.includes('<ellipse'), 'decorative artwork never becomes machine cut/engrave geometry');
const propGeometry = createFabricationPackage(propOnly);
assert(propGeometry.cutList.some(part => part.name === paintedObject.name), 'custom props participate in build materials');
const completeProp = await createPaintedBlueprintPackage(propGeometry, propOnly, { rasterize: async () => rgbaPng });
const completePropPdf = await PDFDocument.load(pdfBytes(completeProp.buildPacketPdf!));
assert.equal(completePropPdf.getPageCount(), 2, 'the object-only packet contains one painted cut sheet and its cut/place guide, without an empty character sheet');
assert(completePropPdf.getPages().every(page => page.getWidth() === 612), 'an unbound prop packet contains no invented mechanism sheet');
assert(imageCount(completePropPdf) > 0, 'full prop build packet retains the painted physical piece');
assert(completeProp.customPartsSvg.includes('data-owner-id="student-prop"'), 'the final object-only Cut pieces SVG retains its explicit physical outline');
assert(propGeometry.assemblyGuideHtml.includes('data-build-section="objects"') && !propGeometry.assemblyGuideHtml.includes('data-build-section="character"'));
assert(propGeometry.assemblyGuidePdf.includes('Cut Painted rocket') && propGeometry.assemblyGuidePdf.includes('Place Painted rocket'));
assert(!propGeometry.assemblyGuidePdf.includes('Fixed pins:') && !propGeometry.assemblyGuidePdf.includes('Free pivots'), 'object-only assembly export invents no character joints or hardware steps');
assert(!/Base board|Module stack|washer|spacer|no board coordinate/.test(propGeometry.assemblyGuidePdf), 'object-only guide does not direct students to build nonexistent board hardware');
assert(!propGeometry.assemblyGuideHtml.includes('no board coordinate'), 'unattached prop steps omit irrelevant board callouts');

// The real body-plus-rocket workflow packs the prop on a second sheet. pdf-lib
// defaults to embedding only page 0 unless every overlay page is requested.
const largeProp = { ...paintedObject, transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    contourPoints: [{ x: -90, y: -75 }, { x: 90, y: -75 }, { x: 90, y: 75 }, { x: -90, y: 75 }]
        .map(point => ({ x: point.x * SCENE_PX_PER_MM, y: point.y * SCENE_PX_PER_MM })),
};
const multiSheetProject = { ...painted, mechanisms: [], sceneObjects: { [largeProp.id]: largeProp }, sceneObjectOrder: [largeProp.id] };
const multiSheetLayout = buildPlanCharacterPrintLayout(createBuildPlanV1(multiSheetProject));
assert(multiSheetLayout.pageCount > 1, 'fixture must exercise later physical sheets');
assert(multiSheetLayout.parts.find(part => part.part.id === largeProp.id)!.pageIndex > 0);
const sheetContents = makeCharacterTemplatePdfPageContentsFromBuildPlan(createBuildPlanV1(multiSheetProject), projectContentFingerprint(multiSheetProject), { painted: true });
assert(sheetContents[1].includes('Sheet 2 of 2 / Print at 100% scale'));
assert(!sheetContents[1].includes('mm holes'), 'a prop-only sheet does not imply nonexistent drilling');
assert(sheetContents.every(content => !content.includes('character-sheet-page-count') && !content.includes('fnv1a32')), 'physical print headers exclude diagnostic keys and provenance hashes');
const multiSheetPackage = await createPaintedBlueprintPackage(createFabricationPackage(multiSheetProject), multiSheetProject, { rasterize: async () => rgbaPng });
const multiSheetPdf = await PDFDocument.load(pdfBytes(multiSheetPackage.customPartsPdf));
assert.equal(JSON.parse((await PDFDocument.load(pdfBytes(multiSheetPackage.buildPacketPdf!))).getSubject()!).sourceProjectFingerprint,
    projectContentFingerprint(multiSheetProject), 'the combined PDF retains captured-source provenance in metadata');
assert.equal(multiSheetPdf.getPageCount(), multiSheetLayout.pageCount);
assert.equal(multiSheetPdf.context.enumerateIndirectObjects().filter(([, object]) =>
    object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')).length, multiSheetLayout.pageCount,
    'every sheet embeds its own cut-line, hole and label overlay');
assert(imageCount(await PDFDocument.load(pdfBytes(multiSheetPackage.buildPacketPdf!))) > 0, 'the complete packet preserves multi-sheet image resources');
const assembly = prepareAssemblyGuideModel({ project: propOnly, selectedRecipeId: null, assemblyMode: 'character', lane: 'kit' });
assert.equal(assembly.characterAssemblyPlan.parts[0].id, object.id);
assert.deepEqual(assembly.characterPlaybackSteps.map(step => step.phase), ['cut-object', 'place-object']);
const propFrame = buildCharacterAssemblySceneFrame({ plan: assembly.characterAssemblyPlan, step: assembly.characterPlaybackSteps[1], kit: propOnly.settings.physicalKit });
assert.deepEqual(propFrame.activePartIds, [object.id]);
assert.equal(propFrame.boardMode, 'hidden');
console.log('painted build packet resources, transforms and source revision contracts ok');
