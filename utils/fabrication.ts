import { FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { calculateLinkage, generateCurvePoints } from './kinematics';
import { boardToScene, pathFromPoints, SCENE_PX_PER_MM, sceneToBoardRaw, sceneToSvg, sceneBoundsForSheet } from './coordinates';
import { mechanismRequiredParts } from './project';
import { mechanismBindingWarnings, preferredMotionJointId } from './motion';

export const sampleFeasibleRange = (mechanism: MechanismConfig, samples = 96) => {
    let valid = 0;
    const validSamples: boolean[] = [];
    const loops = mechanism.type === '5bar' || mechanism.type === 'planetary_gear' ? 8 : 1;
    const totalSamples = samples * loops;
    for (let i = 0; i <= totalSamples; i++) {
        const angle = (i / samples) * Math.PI * 2;
        validSamples[i] = calculateLinkage(mechanism, angle).isValid;
        if (validSamples[i]) valid++;
    }
    const intervals: Array<{ startDeg: number; endDeg: number }> = [];
    let start: number | null = null;
    validSamples.forEach((ok, i) => {
        if (ok && start === null) start = i;
        if ((!ok || i === totalSamples) && start !== null) {
            const end = ok && i === totalSamples ? i : i - 1;
            intervals.push({ startDeg: Math.round(start * 360 / samples), endDeg: Math.round(end * 360 / samples) });
            start = null;
        }
    });
    const intervalText = intervals.map(i => `${i.startDeg}°–${i.endDeg}°`).join(', ');
    return {
        percentValid: valid / (totalSamples + 1),
        startDeg: intervals[0]?.startDeg ?? 0,
        endDeg: intervals.at(-1)?.endDeg ?? 0,
        intervals,
        warning: valid === totalSamples + 1 ? null : valid === 0 ? 'No valid sampled motion' : `Partial motion ${Math.round((valid / (totalSamples + 1)) * 100)}% (${intervalText})`
    };
};

export const validateForFabrication = (project: ProjectState) => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const issues: FabricationIssue[] = [];
    const add = (severity: FabricationIssue['severity'], message: string, extra: Partial<FabricationIssue> = {}) => {
        issues.push({ severity, message, recoveryStage: severity === 'error' ? 'design' : 'blueprint', recoveryAction: 'Review item', ...extra });
        (severity === 'error' ? errors : warnings).push(message);
    };
    const sheet = sceneBoundsForSheet(project.settings.physicalKit);
    const snapTolerance = project.settings.physicsSnapMode === 'fast' ? 4 : project.settings.physicsSnapMode === 'high' ? 0.25 : 0.5;
    const fabricationSeverity: FabricationIssue['severity'] = project.settings.fabricationReadyMode ? 'error' : 'warning';
    const insideSheet = (p: { x: number; y: number }) => p.x >= sheet.x && p.x <= sheet.x + sheet.width && p.y >= sheet.y && p.y <= sheet.y + sheet.height;
    if (!project.partOrder.length) add('error', 'No character in scene.', { recoveryStage: 'character', recoveryAction: 'Load a character package' });
    const activeMechanisms = project.mechanisms.filter(m => m.visible && m.enabled !== false);
    if (!activeMechanisms.length) add('error', 'No enabled mechanism to export.', { recoveryStage: 'design', recoveryAction: 'Enable or add a mechanism' });
    const bindingWarnings = mechanismBindingWarnings(project, activeMechanisms);
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const corners = [
            { x: part.transform.x + part.bounds.x * part.transform.scale, y: part.transform.y + part.bounds.y * part.transform.scale },
            { x: part.transform.x + (part.bounds.x + part.bounds.width) * part.transform.scale, y: part.transform.y + part.bounds.y * part.transform.scale },
            { x: part.transform.x + part.bounds.x * part.transform.scale, y: part.transform.y + (part.bounds.y + part.bounds.height) * part.transform.scale },
            { x: part.transform.x + (part.bounds.x + part.bounds.width) * part.transform.scale, y: part.transform.y + (part.bounds.y + part.bounds.height) * part.transform.scale }
        ];
        if (corners.some(p => !insideSheet(p))) add('warning', `${part.id}: visible part extends outside sheet bounds.`, { partId, recoveryStage: 'path', recoveryAction: 'Move part inside sheet' });
    });
    activeMechanisms.forEach(m => {
        (bindingWarnings[m.id] ?? []).forEach(message => add('error', `${m.id}: ${message}`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Rebind mechanism target' }));
        if (!m.id) add('error', 'Mechanism missing per-instance id.', { recoveryStage: 'design', recoveryAction: 'Select or recreate mechanism' });
        if (!m.targetPartId || !m.targetPathId) add('error', `${m.id}: choose a target part and path before blueprint export.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Choose target part and path' });
        if (m.targetPartId && !project.parts[m.targetPartId]) add('error', `${m.id}: target part ${m.targetPartId} is missing.`, { mechanismId: m.id, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Choose an existing target part' });
        if (m.targetPathId) {
            const path = project.paths[m.targetPathId];
            if (!path) add('error', `${m.id}: target path ${m.targetPathId} is missing.`, { mechanismId: m.id, pathId: m.targetPathId, recoveryStage: 'path', recoveryAction: 'Create or select a valid path' });
            else if (m.targetPartId && path.partId !== m.targetPartId) add('error', `${m.id}: target path ${m.targetPathId} belongs to ${path.partId}, not ${m.targetPartId}.`, { mechanismId: m.id, pathId: m.targetPathId, partId: m.targetPartId, recoveryStage: 'design', recoveryAction: 'Rebind target path' });
        }
        const physicalNumbers = [m.crankLength, m.couplerLength, m.groundLength, m.rockerLength, m.sliderOffset, m.couplerPointDist, m.couplerPointAngle];
        if (m.type === '5bar' || m.type === 'piston') physicalNumbers.push(m.rodLength ?? Number.NaN);
        if (m.type === 'gear' || m.type === 'planetary_gear') physicalNumbers.push(m.gearRatio ?? Number.NaN, m.speed2 ?? Number.NaN);
        if (!physicalNumbers.every(Number.isFinite)) add('error', `${m.id}: non-finite physical dimension.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Fix mechanism dimensions' });
        if ((m.type === 'gear' || m.type === 'planetary_gear') && (m.gearRatio ?? 0) === 0) add('error', `${m.id}: gear ratio cannot be zero.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Choose a non-zero gear ratio' });
        if (m.type === 'gear' || m.type === 'planetary_gear') {
            const expectedCenterDistance = m.crankLength + m.rockerLength;
            if (Math.abs(m.groundLength - expectedCenterDistance) > Math.max(1, expectedCenterDistance * 0.03)) {
                add(fabricationSeverity, `${m.id}: gear pitch centers must equal input radius + output radius.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Snap gear center distance to pitch radii' });
            }
        }
        if (m.type === 'rack-pinion' && Math.abs(m.sliderOffset) < Math.max(2, m.crankLength * 0.8)) add('warning', `${m.id}: rack guide is too close to the pinion pitch circle.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Increase rack offset or reduce pinion radius' });
        if (m.type === 'rack-pinion' && m.rockerLength < m.crankLength * (2 * Math.PI + 2)) add(fabricationSeverity, `${m.id}: rack is too short for a full pinion turn and visible end stops.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Lengthen rack/guide or reduce pinion radius' });
        const range = sampleFeasibleRange(m);
        if (range.warning?.startsWith('No valid')) add('error', `${m.id}: ${range.warning}.`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Adjust mechanism parameters' });
        else if (range.warning) add('warning', `${m.id}: ${range.warning}`, { mechanismId: m.id, recoveryStage: 'foundry', recoveryAction: 'Review partial motion' });
        if (!Number.isFinite(m.anchorX) || !Number.isFinite(m.anchorY)) {
            add('error', `${m.id}: missing board coordinate anchor.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Drag mechanism onto board grid' });
            return;
        }
        const board = sceneToBoardRaw({ x: m.anchorX!, y: m.anchorY! }, project.settings.physicalKit);
        const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : null;
        if (!board.valid) add(fabricationSeverity, `${m.id}: anchor outside board at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move anchor onto board' });
        else if (boardScene && Math.hypot(boardScene.x - m.anchorX!, boardScene.y - m.anchorY!) > snapTolerance) add(fabricationSeverity, `${m.id}: anchor off grid at ${board.label}; snap to a board hole before export.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Snap anchor to board hole' });
        else if (board.col <= 0 || board.row <= 0 || board.col >= project.settings.physicalKit.boardCells - 1 || board.row >= project.settings.physicalKit.boardCells - 1) {
            add('warning', `${m.id}: anchor near board edge at ${board.label}.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Move anchor inward if needed' });
        }
        const path = generateCurvePoints(m, 72).points;
        if (path.some(p => !insideSheet(p))) add('error', `${m.id}: generated mechanism path leaves sheet bounds.`, { mechanismId: m.id, recoveryStage: 'design', recoveryAction: 'Resize or move mechanism' });
    });
    return { warnings, errors, issues };
};

const createRecipe = (project: ProjectState, mechanism: MechanismConfig): FabricationRecipe => {
    if (!Number.isFinite(mechanism.anchorX) || !Number.isFinite(mechanism.anchorY)) throw new Error(`${mechanism.id}: missing board coordinate anchor.`);
    const board = sceneToBoardRaw({ x: mechanism.anchorX!, y: mechanism.anchorY! }, project.settings.physicalKit);
    const boardScene = board.valid ? boardToScene(board.col, board.row, project.settings.physicalKit) : { x: mechanism.anchorX!, y: mechanism.anchorY! };
    const targetPart = mechanism.targetPartId ? project.parts[mechanism.targetPartId] : undefined;
    const targetPath = mechanism.targetPathId ? project.paths[mechanism.targetPathId] : undefined;
    const targetAnchorJointId = preferredMotionJointId(project, mechanism.targetPartId, mechanism.targetAnchorJointId);
    const range = sampleFeasibleRange(mechanism);
    const warnings = [...new Set([
        ...(mechanism.warnings ?? []),
        ...((mechanism.fabricationMetadata as { warnings?: string[] } | undefined)?.warnings ?? []),
        ...(range.warning ? [range.warning] : []),
        ...((targetPart && !targetPart.visible) ? ['Target part hidden'] : [])
    ])];
    return {
        mechanismId: mechanism.id,
        type: mechanism.type,
        targetPartId: mechanism.targetPartId,
        targetPathId: mechanism.targetPathId,
        targetAnchorJointId,
        targetPartName: targetPart?.name,
        targetPathPointCount: targetPath?.points.length,
        boardCoordinate: board.label,
        board,
        sceneAnchor: { x: mechanism.anchorX!, y: mechanism.anchorY! },
        offsetFromBoardMm: { x: (mechanism.anchorX! - boardScene.x) / SCENE_PX_PER_MM, y: (mechanism.anchorY! - boardScene.y) / SCENE_PX_PER_MM },
        requiredParts: mechanism.fabricationMetadata?.requiredParts ?? mechanismRequiredParts(mechanism),
        steps: [
            `Place ${mechanism.id} main axle at ${board.label}.`,
            mechanism.type === 'cam'
                ? `Install the cam disk and follower guide aligned to ${mechanism.groundAngle ?? 90}°; follower lift is ${(mechanism.rockerLength || mechanism.crankLength).toFixed(0)} scene units.`
                : mechanism.type === 'rack-pinion'
                    ? `Mesh the pinion gear with the toothed rack; keep the rack guide offset ${mechanism.sliderOffset.toFixed(0)} scene units from the axle and add end stops.`
                    : mechanism.type === 'gear' || mechanism.type === 'planetary_gear'
                        ? `Mesh gears at their pitch centers; ratio ${mechanism.gearRatio ?? mechanism.speed2 ?? 1} controls output direction.`
                        : `Install ${mechanism.type} links with crank ${mechanism.crankLength.toFixed(0)} and coupler ${mechanism.couplerLength.toFixed(0)} scene units.`,
            targetPart ? `Connect output to ${targetPart.name} at anchor ${targetAnchorJointId ?? targetPart.anchorJointId} and follow path ${targetPath?.id ?? 'unassigned'}.` : 'Connect output to selected character part or leave as standalone preview.',
            warnings.length ? `Resolve warning before cutting: ${warnings.join('; ')}` : 'Run preview once, then cut and assemble.'
        ],
        warnings
    };
};

const makeSvg = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch));
    const color = (value: string | undefined) => /^#[0-9a-fA-F]{3,8}$/.test(value ?? '') ? value : '#64748b';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 680" width="900" height="680">`;
    svg += `<metadata>${esc(JSON.stringify({ project: project.metadata.name, profile: kit.profileKey, gridPitchMm: kit.gridPitchMm, mechanisms: recipes.map(r => r.mechanismId) }))}</metadata>`;
    svg += `<rect width="900" height="680" fill="#f8fafc"/>`;
    const sheet = { x: 450 + bounds.x, y: 340 - bounds.y - bounds.height, width: bounds.width, height: bounds.height };
    svg += `<rect x="${sheet.x}" y="${sheet.y}" width="${sheet.width}" height="${sheet.height}" fill="#fff" stroke="#0f172a" stroke-width="1.5"/>`;
    for (let c = 0; c < kit.boardCells; c++) {
        for (let r = 0; r < kit.boardCells; r++) {
            const recipe = recipes.find(x => x.board.valid !== false && x.board.col === c && x.board.row === r);
            const { x, y } = sceneToSvg(boardToScene(c, r, kit));
            svg += `<circle cx="${x}" cy="${y}" r="${recipe ? 5 : 2}" fill="${recipe ? '#ef4444' : '#cbd5e1'}"/>`;
            if (recipe) svg += `<text x="${x + 8}" y="${y - 8}" font-size="12" font-family="Inter,Arial" fill="#0f172a">${esc(recipe.mechanismId)} ${esc(recipe.boardCoordinate)}</text>`;
        }
    }
    project.partOrder.forEach(partId => {
        const part = project.parts[partId];
        if (!part?.visible) return;
        const p = sceneToSvg(part.transform);
        const w = part.bounds.width * part.transform.scale;
        const h = part.bounds.height * part.transform.scale;
        svg += `<g transform="translate(${p.x} ${p.y}) rotate(${-(Number(part.transform.rotation) || 0)})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="12" fill="${color(part.fillColor)}" opacity="0.22" stroke="${color(part.fillColor)}"/></g>`;
    });
    project.mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        const points = generateCurvePoints(m, 72).points;
        if (points.length > 1) svg += `<path d="${pathFromPoints(points)}" fill="none" stroke="${color(m.color)}" stroke-width="2" opacity="0.8"/>`;
    });
    svg += `</svg>`;
    return svg;
};

const makeAssemblyGuideHtml = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => {
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
    const firstRecipe = recipes[0];
    const explodedSvg = `<svg class="exploded-guide" viewBox="0 0 900 520" role="img" aria-label="Exploded view assembly order">
<defs>
<pattern id="guide-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#dbeafe" stroke-width="1"/></pattern>
<linearGradient id="guide-cardboard" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#f8dfaa"/><stop offset="0.55" stop-color="#e8bc73"/><stop offset="1" stop-color="#b97731"/></linearGradient>
<filter id="guide-shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="12" dy="16" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.18"/></filter>
</defs>
<rect width="900" height="520" rx="28" fill="#ffffff"/>
<rect width="900" height="520" fill="url(#guide-grid)" opacity="0.68"/>
<g transform="translate(110 38)" filter="url(#guide-shadow)">
<path d="M 70 390 C 190 322, 320 298, 510 340 S 665 404, 760 330" fill="none" stroke="#6366f1" stroke-width="8" stroke-linecap="round" stroke-dasharray="18 15" opacity=".78"/>
<text x="590" y="352" class="guide-blue">Path projection</text>
<g transform="translate(160 338)">
<rect x="0" y="0" width="260" height="34" rx="17" fill="#d8b077" stroke="#7c4a21" stroke-width="4"/>
<circle cx="34" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/><circle cx="226" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/>
<text x="82" y="66" class="guide-label">Z=0 Base</text>
</g>
<g transform="translate(154 222) rotate(-26)">
<rect x="0" y="0" width="220" height="34" rx="17" fill="#f4d49b" stroke="#7c4a21" stroke-width="4"/>
<circle cx="30" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/><circle cx="190" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/>
</g>
<text x="120" y="210" class="guide-label">Z=1 Input</text>
<g transform="translate(420 178) rotate(24)">
<rect x="0" y="0" width="250" height="34" rx="17" fill="url(#guide-cardboard)" stroke="#7c4a21" stroke-width="4"/>
<circle cx="32" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/><circle cx="218" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/>
</g>
<text x="620" y="170" class="guide-label">Z=1 Output</text>
<g transform="translate(324 74)">
<rect x="0" y="0" width="245" height="34" rx="17" fill="#e7c48a" stroke="#7c4a21" stroke-width="4"/>
<circle cx="36" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/><circle cx="208" cy="17" r="10" fill="#fff" stroke="#2563eb" stroke-width="4"/>
<text x="58" y="-18" class="guide-label">Z=2 Coupler</text>
</g>
</g>
<g transform="translate(38 36)">
<rect width="252" height="58" rx="20" fill="#ffffff" stroke="#c7d2fe" stroke-width="2"/>
<text x="22" y="25" class="guide-title">Exploded view</text>
<text x="22" y="45" class="guide-muted">Assembly → Exploded Z-axis order</text>
</g>
${firstRecipe ? `<text x="40" y="492" class="guide-muted">First recipe: ${esc(firstRecipe.mechanismId)} · ${esc(firstRecipe.type)} · hole ${esc(firstRecipe.boardCoordinate)}</text>` : ''}
</svg>`;
    const recipeSections = recipes.map(recipe => `<section>
<h2>${esc(recipe.mechanismId)} · ${esc(recipe.type)}</h2>
<p><strong>Board coordinate:</strong> ${esc(recipe.boardCoordinate)} (${recipe.sceneAnchor.x.toFixed(1)}, ${recipe.sceneAnchor.y.toFixed(1)} scene units)</p>
<p><strong>Target:</strong> ${esc(recipe.targetPartName ?? recipe.targetPartId ?? 'unbound')} · path ${esc(recipe.targetPathId ?? 'none')} · anchor ${esc(recipe.targetAnchorJointId ?? 'part default')} · ${recipe.targetPathPointCount ?? 0} path points</p>
${recipe.warnings.length ? `<p><strong>Warnings:</strong> ${recipe.warnings.map(esc).join('; ')}</p>` : '<p><strong>Warnings:</strong> none</p>'}
<h3>Required parts</h3><ul>${recipe.requiredParts.map(part => `<li>${esc(part.name)} × ${part.quantity}</li>`).join('')}</ul>
<h3>Steps</h3><ol>${recipe.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
</section>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(project.metadata.name)} assembly</title><style>
body{margin:0;background:#f8f9ff;color:#172033;font-family:Inter,Arial,sans-serif;}
.page{max-width:980px;margin:0 auto;padding:28px;}
.print-actions{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:16px;align-items:center;margin:-28px -28px 20px;padding:14px 28px;background:rgba(255,255,255,.94);border-bottom:1px solid #dbe3f0;backdrop-filter:blur(12px);}
button{border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#172033;padding:10px 16px;font-weight:800;cursor:pointer;}
h1{margin:0;font-size:40px;line-height:.98;letter-spacing:-.05em;} h2{margin:0 0 10px;font-size:24px;} h3{margin:18px 0 8px;}
.subtitle{color:#64748b;font-weight:750;}
.exploded-guide{display:block;width:100%;margin:22px 0;border:1px solid #dbe3f0;border-radius:28px;background:#fff;box-shadow:0 22px 70px rgba(15,23,42,.10);}
.guide-title{font-size:20px;font-weight:900;fill:#172033}.guide-label{font-size:18px;font-weight:900;fill:#64748b}.guide-muted{font-size:14px;font-weight:800;fill:#64748b}.guide-blue{font-size:18px;font-weight:900;fill:#4f46e5}
.warning{border:1px solid #fed7aa;border-radius:14px;background:#fff7ed;padding:12px;margin:10px 0;font-weight:750;}
section{break-inside:avoid;margin:18px 0;padding:20px;border:1px solid #dbe3f0;border-radius:22px;background:#fff;box-shadow:0 16px 46px rgba(15,23,42,.06);}
li{margin:.32rem 0;line-height:1.42;}
@media print{body{background:#fff}.page{max-width:none;padding:10mm}.print-actions{display:none}.exploded-guide,section{box-shadow:none}section{page-break-inside:avoid}}
</style></head><body><main class="page"><div class="print-actions"><strong>Printable assembly guide</strong><button onclick="window.print()">Print guide</button></div><h1>${esc(project.metadata.name)} assembly guide</h1><p class="subtitle">Profile ${esc(project.settings.physicalKit.profileKey)} · ${project.settings.physicalKit.gridPitchMm}mm grid · exploded view for foundry and assembly handoff.</p>${explodedSvg}${warnings.map(w => `<p class="warning"><strong>Warning:</strong> ${esc(w)}</p>`).join('')}${recipeSections}</main></body></html>`;
};

const makePdfDocument = (content: string) => {
    const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
        '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
        `5 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach(obj => { offsets.push(pdf.length); pdf += `${obj}\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\n`;
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
};

const pdfText = (value: unknown) => String(value)
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/[()\\]/g, '\\$&')
    .slice(0, 120);

const num = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '0';

const circlePath = (x: number, y: number, r: number) => {
    const k = r * 0.5522847498;
    return `${num(x + r)} ${num(y)} m ${num(x + r)} ${num(y + k)} ${num(x + k)} ${num(y + r)} ${num(x)} ${num(y + r)} c ${num(x - k)} ${num(y + r)} ${num(x - r)} ${num(y + k)} ${num(x - r)} ${num(y)} c ${num(x - r)} ${num(y - k)} ${num(x - k)} ${num(y - r)} ${num(x)} ${num(y - r)} c ${num(x + k)} ${num(y - r)} ${num(x + r)} ${num(y - k)} ${num(x + r)} ${num(y)} c h`;
};

const hexRgb = (value: string | undefined) => {
    const safe = /^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : '#5a6cff';
    const r = parseInt(safe.slice(1, 3), 16) / 255;
    const g = parseInt(safe.slice(3, 5), 16) / 255;
    const b = parseInt(safe.slice(5, 7), 16) / 255;
    return `${num(r)} ${num(g)} ${num(b)}`;
};

const makeCutSheetPdf = (project: ProjectState, recipes: FabricationRecipe[]) => {
    const kit = project.settings.physicalKit;
    const bounds = sceneBoundsForSheet(kit);
    const page = { width: 612, height: 792, margin: 38, titleY: 760 };
    const scale = Math.min((page.width - page.margin * 2) / bounds.width, (page.height - 150) / bounds.height);
    const origin = { x: page.width / 2, y: 390 };
    const toPdf = (p: { x: number; y: number }) => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale });
    const sheetLeft = origin.x + bounds.x * scale;
    const sheetBottom = origin.y + bounds.y * scale;
    const commands: string[] = [
        `BT /F1 14 Tf ${page.margin} ${page.titleY} Td (Cut sheet: ${pdfText(project.metadata.name)}) Tj ET`,
        `BT /F1 9 Tf ${page.margin} ${page.titleY - 18} Td (Profile ${pdfText(kit.profileKey)} / ${kit.gridPitchMm}mm pitch / ${kit.boardCells}x${kit.boardCells} board holes) Tj ET`,
        '0.92 0.95 1.00 rg 0.10 0.16 0.28 RG 1.1 w',
        `${num(sheetLeft)} ${num(sheetBottom)} ${num(bounds.width * scale)} ${num(bounds.height * scale)} re B`
    ];
    for (let c = 0; c < kit.boardCells; c++) {
        for (let r = 0; r < kit.boardCells; r++) {
            const recipe = recipes.find(x => x.board.valid !== false && x.board.col === c && x.board.row === r);
            const p = toPdf(boardToScene(c, r, kit));
            commands.push(recipe ? '0.94 0.27 0.27 rg' : '0.62 0.68 0.78 rg');
            commands.push(`${circlePath(p.x, p.y, recipe ? 3.8 : 1.7)} f`);
            if (recipe) commands.push(`0.10 0.16 0.28 rg BT /F1 7 Tf ${num(p.x + 6)} ${num(p.y + 5)} Td (${pdfText(`${recipe.mechanismId} ${recipe.boardCoordinate}`)}) Tj ET`);
        }
    }
    project.mechanisms.filter(m => m.visible && m.enabled !== false).forEach(m => {
        const points = generateCurvePoints(m, 48).points.map(toPdf);
        if (points.length > 1) {
            commands.push(`${hexRgb(m.color)} RG 0.9 w`);
            commands.push(`${num(points[0].x)} ${num(points[0].y)} m ${points.slice(1).map(p => `${num(p.x)} ${num(p.y)} l`).join(' ')} S`);
        }
    });
    recipes.slice(0, 12).forEach((recipe, index) => {
        commands.push(`0.10 0.16 0.28 rg BT /F1 8 Tf ${page.margin} ${118 - index * 10} Td (${pdfText(`${recipe.mechanismId}: ${recipe.type} at ${recipe.boardCoordinate}`)}) Tj ET`);
    });
    return makePdfDocument(commands.join('\n'));
};

const makeSimplePdf = (title: string, lines: string[]) => {
    const text = [title, ...lines].slice(0, 46);
    const content = `BT /F1 14 Tf 50 760 Td ${text.map((line, i) => `${i ? '0 -16 Td ' : ''}(${pdfText(line)}) Tj`).join(' ')} ET`;
    return makePdfDocument(content);
};

const makeAssemblyGuidePdf = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => makeSimplePdf(
    `${project.metadata.name} Printable assembly guide`,
    [
        'Exploded view / Assembly -> Exploded Z-axis order',
        'Path projection / Z=0 Base / Z=1 Input / Z=1 Output / Z=2 Coupler',
        `Profile ${project.settings.physicalKit.profileKey} / ${project.settings.physicalKit.gridPitchMm}mm grid`,
        ...warnings.map(warning => `Warning: ${warning}`),
        ...recipes.flatMap(recipe => [
            `${recipe.mechanismId} / ${recipe.type} / ${recipe.boardCoordinate}`,
            `Target: ${recipe.targetPartName ?? recipe.targetPartId ?? 'unbound'} / path ${recipe.targetPathId ?? 'none'} / anchor ${recipe.targetAnchorJointId ?? 'part default'}`,
            `Required parts: ${recipe.requiredParts.map(part => `${part.name} x ${part.quantity}`).join(', ')}`,
            ...recipe.steps
        ])
    ]
);

export const createFabricationPackage = (project: ProjectState): FabricationPackage => {
    const validation = validateForFabrication(project);
    if (validation.errors.length) throw new Error(validation.errors.join('\n'));
    const recipes = project.mechanisms.filter(m => m.visible && m.enabled !== false).map(m => createRecipe(project, m));
    const cutList = Array.from(
        recipes.flatMap(r => r.requiredParts).reduce((map, item) => {
            map.set(item.name, (map.get(item.name) ?? 0) + item.quantity);
            return map;
        }, new Map<string, number>())
    ).map(([name, quantity]) => ({ name, quantity }));

    const metadata = {
        projectId: project.metadata.id,
        projectName: project.metadata.name,
        createdAt: new Date().toISOString(),
        profile: project.settings.physicalKit,
        validationIssues: validation.issues,
        sceneSnapshot: { metadata: project.metadata, paths: project.paths, mechanisms: project.mechanisms },
        recipes: recipes.map(r => ({
            mechanismId: r.mechanismId,
            type: r.type,
            targetPartId: r.targetPartId,
            targetPathId: r.targetPathId,
            targetAnchorJointId: r.targetAnchorJointId,
            targetPartName: r.targetPartName,
            targetPathPointCount: r.targetPathPointCount,
            boardCoordinate: r.boardCoordinate,
            board: r.board,
            sceneAnchor: r.sceneAnchor,
            requiredParts: r.requiredParts,
            warnings: r.warnings,
            steps: r.steps
        }))
    };
    const createdAt = metadata.createdAt;
    return {
        id: `fab-${Date.now().toString(36)}`,
        createdAt,
        projectName: project.metadata.name,
        sceneSnapshot: {
            metadata: project.metadata,
            parts: project.parts,
            partOrder: project.partOrder,
            skeleton: project.skeleton,
            paths: project.paths,
            mechanisms: project.mechanisms,
            settings: project.settings
        },
        recipes,
        cutList,
        warnings: validation.warnings,
        validationIssues: validation.issues,
        svg: makeSvg(project, recipes),
        cutSheetPdf: makeCutSheetPdf(project, recipes),
        assemblyGuideHtml: makeAssemblyGuideHtml(project, recipes, validation.warnings),
        assemblyGuidePdf: makeAssemblyGuidePdf(project, recipes, validation.warnings),
        metadataJson: JSON.stringify(metadata, null, 2)
    };
};
