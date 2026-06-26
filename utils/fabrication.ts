import { FabricationIssue, FabricationPackage, FabricationRecipe, MechanismConfig, ProjectState } from '../types';
import { calculateLinkage, generateCurvePoints } from './kinematics';
import { boardToScene, pathFromPoints, SCENE_PX_PER_MM, sceneToBoardRaw, sceneToSvg, sceneBoundsForSheet } from './coordinates';
import { mechanismRequiredParts } from './project';
import { mechanismBindingWarnings, preferredMotionJointId } from './motion';


export type FabricationStackLayer = {
    label: string;
    role: 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';
    color: string;
};

export type FabricationRenderKind = 'base' | 'clip' | 'linkage' | 'spacer' | 'gear' | 'guide' | 'cam' | 'rack' | 'follower';

export type FabricationRenderLayer = FabricationStackLayer & {
    source: 'fabrication-stack';
    stackIndex: number;
    occurrence: number;
    z: number;
    renderKind: FabricationRenderKind;
};

export type FabricationRenderPlan = {
    base: FabricationRenderLayer;
    layers: FabricationRenderLayer[];
    stackSummary: string;
    roleSummary: string;
    colorSummary: string;
    zSummary: string;
    validationErrors: string[];
};

export const STACK_COLORS: Record<FabricationStackLayer['role'], string> = {
    base: '#e2e8f0',
    clip: '#334155',
    linkage: '#60a5fa',
    spacer: '#f59e0b',
    gear: '#8b5cf6',
    guide: '#10b981',
    cam: '#f97316',
    rack: '#14b8a6',
    follower: '#f472b6'
};

const layer = (label: string, role: FabricationStackLayer['role']): FabricationStackLayer => ({ label, role, color: STACK_COLORS[role] });

export const fabricationBaseLayer = (): FabricationStackLayer => layer('Base board', 'base');

export const fabricationStackForMechanism = (mechanism: Pick<MechanismConfig, 'type'>): FabricationStackLayer[] => {
    const linked = (...middle: FabricationStackLayer[]) => [layer('Back Clip', 'clip'), ...middle, layer('Front Clip', 'clip')];
    const spacer = () => layer('Spacer washer', 'spacer');
    switch (mechanism.type) {
        case 'gear':
            return linked(layer('Drive gear', 'gear'), spacer(), layer('Output gear', 'gear'), spacer(), layer('Output linkage', 'linkage'));
        case 'planetary_gear':
            return linked(layer('Ring gear', 'gear'), spacer(), layer('Carrier linkage', 'linkage'), spacer(), layer('Planet gear', 'gear'), spacer(), layer('Sun gear', 'gear'));
        case 'rack-pinion':
            return linked(layer('Pinion gear', 'gear'), spacer(), layer('Rack guide', 'guide'), spacer(), layer('Toothed rack', 'rack'), spacer(), layer('Output linkage', 'linkage'));
        case 'cam':
            return linked(layer('Cam disk', 'cam'), spacer(), layer('Follower guide', 'guide'), spacer(), layer('Follower linkage', 'follower'));
        case 'piston':
        case 'yoke':
        case 'quick-return':
            return linked(layer('Crank linkage', 'linkage'), spacer(), layer('Slider guide', 'guide'), spacer(), layer('Output linkage', 'linkage'));
        case '5bar':
            return linked(layer('Left timing gear', 'gear'), spacer(), layer('Left crank linkage', 'linkage'), spacer(), layer('Right timing gear', 'gear'), spacer(), layer('Right crank linkage', 'linkage'), spacer(), layer('Center coupler', 'linkage'));
        default:
            return linked(layer('Input linkage', 'linkage'), spacer(), layer('Coupler linkage', 'linkage'), spacer(), layer('Output linkage', 'linkage'));
    }
};

export const fabricationStackSummary = (mechanism: Pick<MechanismConfig, 'type'>) => fabricationStackForMechanism(mechanism).map(item => item.label).join(' → ');

const isMovingStackLayer = (item: FabricationStackLayer) => !['clip', 'spacer', 'base'].includes(item.role);

export const validateFabricationStack = (mechanism: Pick<MechanismConfig, 'type'> | FabricationStackLayer[]) => {
    const stack = Array.isArray(mechanism) ? mechanism : fabricationStackForMechanism(mechanism);
    const errors: string[] = [];
    if (stack.some(item => item.role === 'base')) errors.push('moving stack must not include Base board');
    if (stack[0]?.role !== 'clip') errors.push('moving stack must start with a back clip');
    if (stack.at(-1)?.role !== 'clip') errors.push('moving stack must end with a front clip');
    if (!stack.some(item => item.role === 'spacer')) errors.push('moving stack must include at least one spacer washer');
    stack.slice(1, -1).forEach((item, index, middle) => {
        if (item.role === 'clip') errors.push(`${item.label} clip may only appear at stack ends`);
        if (item.role === 'spacer') {
            const prev = index > 0 ? middle[index - 1] : stack[0];
            const next = index < middle.length - 1 ? middle[index + 1] : stack.at(-1);
            if (!prev || !next || !isMovingStackLayer(prev) || !isMovingStackLayer(next)) errors.push(`${item.label} must sit between two moving layers`);
        }
        const next = index < middle.length - 1 ? middle[index + 1] : stack.at(-1);
        if (isMovingStackLayer(item) && next && isMovingStackLayer(next)) errors.push(`${item.label} and ${next.label} need a spacer washer between them`);
    });
    return errors;
};

const renderKindForRole = (role: FabricationStackLayer['role']): FabricationRenderKind => role === 'base' ? 'base' : role;

export const fabricationRenderPlanForMechanism = (mechanism: Pick<MechanismConfig, 'type'>): FabricationRenderPlan => {
    const stack = fabricationStackForMechanism(mechanism);
    const validationErrors = validateFabricationStack(stack);
    const occurrenceByRole = new Map<FabricationStackLayer['role'], number>();
    const makeRenderLayer = (item: FabricationStackLayer, stackIndex: number): FabricationRenderLayer => {
        const occurrence = occurrenceByRole.get(item.role) ?? 0;
        occurrenceByRole.set(item.role, occurrence + 1);
        return {
            ...item,
            source: 'fabrication-stack',
            stackIndex,
            occurrence,
            z: stackIndex === -1 ? 0 : 0.22 + stackIndex * 0.18,
            renderKind: renderKindForRole(item.role)
        };
    };
    const base: FabricationRenderLayer = {
        ...fabricationBaseLayer(),
        source: 'fabrication-stack',
        stackIndex: -1,
        occurrence: 0,
        z: 0,
        renderKind: 'base'
    };
    const layers = stack.map(makeRenderLayer);
    return {
        base,
        layers,
        stackSummary: layers.map(item => item.label).join(' → '),
        roleSummary: layers.map(item => item.role).join('>'),
        colorSummary: layers.map(item => item.color).join(','),
        zSummary: layers.map(item => item.z.toFixed(2)).join(','),
        validationErrors
    };
};

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
            `Exploded moving stack order: ${fabricationStackSummary(mechanism)} above the base board.`,
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


const makeExplodedStackSvg = (recipe: FabricationRecipe | undefined, esc: (value: unknown) => string) => {
    const stack = recipe ? fabricationStackForMechanism(recipe) : [];
    const base = fabricationBaseLayer();
    const rows = stack.length ? stack : [layer('Back Clip', 'clip'), layer('Input linkage', 'linkage'), layer('Spacer washer', 'spacer'), layer('Output linkage', 'linkage'), layer('Front Clip', 'clip')];
    const shapeFor = (item: FabricationStackLayer, x: number, y: number) => {
        const fill = item.color;
        const stroke = item.role === 'clip' ? '#0f172a' : '#334155';
        if (item.role === 'gear' || item.role === 'cam') return `<circle cx="${x + 72}" cy="${y + 18}" r="30" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
        if (item.role === 'spacer') return `<circle cx="${x + 72}" cy="${y + 18}" r="20" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff"/>`;
        if (item.role === 'base' || item.role === 'guide') return `<rect x="${x}" y="${y}" width="180" height="36" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
        if (item.role === 'rack') return `<rect x="${x}" y="${y + 5}" width="170" height="26" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="3"/><path d="M ${x + 14} ${y + 5} ${Array.from({ length: 12 }, (_, i) => `L ${x + 24 + i * 12} ${i % 2 ? y + 5 : y - 6}`).join(' ')}" fill="none" stroke="#334155" stroke-width="2"/>`;
        return `<rect x="${x}" y="${y}" width="190" height="36" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 28}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/><circle cx="${x + 162}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
    };
    const items = rows.map((item, index) => {
        const x = 110 + index * 44;
        const y = 360 - index * 38;
        const labelX = 565;
        const labelY = 410 - index * 31;
        return `<g>
<line x1="${x + 72}" y1="${y + 18}" x2="${labelX - 22}" y2="${labelY - 4}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6 8"/>
${shapeFor(item, x, y)}
	<text x="${labelX}" y="${labelY}" class="guide-label">Z+${index + 1} ${esc(item.label)}</text>
	<text x="${labelX}" y="${labelY + 18}" class="guide-muted">${esc(item.role)}</text>
	</g>`;
    }).join('');
    return `<svg class="exploded-guide" viewBox="0 0 900 520" role="img" aria-label="Exploded view assembly order">
<defs>
<pattern id="guide-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#dbeafe" stroke-width="1"/></pattern>
<filter id="guide-shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="10" dy="14" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.14"/></filter>
</defs>
<rect width="900" height="520" rx="28" fill="#ffffff"/>
<rect width="900" height="520" fill="url(#guide-grid)" opacity="0.55"/>
<path d="M 80 462 C 230 410, 330 356, 490 382 S 660 444, 818 356" fill="none" stroke="#6366f1" stroke-width="7" stroke-linecap="round" stroke-dasharray="18 15" opacity=".62"/>
<text x="646" y="354" class="guide-blue">Path projection</text>
<g transform="translate(38 36)">
<rect width="330" height="74" rx="20" fill="#ffffff" stroke="#c7d2fe" stroke-width="2"/>
<text x="22" y="25" class="guide-title">Exploded view</text>
	<text x="22" y="47" class="guide-muted">Base board below · moving stack: Clip → Linkage/Gear → Spacer → Linkage → Clip</text>
	<text x="22" y="64" class="guide-muted">Z=0 Base board · ${recipe ? esc(recipe.mechanismId) : 'pending recipe'}</text>
	</g>
	<g transform="translate(86 426)">
	<rect width="310" height="36" rx="9" fill="${base.color}" stroke="#334155" stroke-width="3"/>
	<text x="18" y="24" class="guide-muted">Z=0 ${esc(base.label)} · all moving parts float above with spacers</text>
	</g>
	<g filter="url(#guide-shadow)">${items}</g>
<line x1="92" y1="458" x2="438" y2="130" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 10"/>
<text x="70" y="486" class="guide-muted">Assembly stack separates moving layers with spacers so clips do not bind.</text>
${recipe ? `<text x="40" y="505" class="guide-muted">First recipe: ${esc(recipe.mechanismId)} · ${esc(recipe.type)} · hole ${esc(recipe.boardCoordinate)}</text>` : ''}
</svg>`;
};

const makeAssemblyGuideHtml = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => {
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
    const firstRecipe = recipes[0];
    const explodedSvg = makeExplodedStackSvg(firstRecipe, esc);
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
        'Exploded view / Base board below / Clip -> Linkage or Gear -> Spacer -> Linkage -> Clip',
        `Stack: ${recipes[0] ? fabricationStackSummary(recipes[0]) : 'pending recipe'}`,
        'Path projection / Z=0 Base / spacer-separated moving layers',
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
