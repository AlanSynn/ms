import type { FabricationRecipe, ProjectState } from '../types';
import { fabricationPartDisplayLabel, FABRICATION_SPACER_SPEC } from './fabricationContract';
import { makeSimplePdf } from './simplePdf';
import { mechanismTypeLabel, readableStepCoordinateCallout, recipeBoardCallout, recipeTargetCallout } from './fabricationRecipes';
import {
    STACK_COLORS,
    fabricationBaseLayer,
    type FabricationStackLayer
} from './fabricationStackModel';
import { sampledCamProfileScale } from './kinematics';

const recipeStackRole = (role: string, label: string): FabricationStackLayer['role'] | null => {
    const text = `${role} ${label}`;
    if (/board-hole|link-joint-hole|gear-handle-hole|link-end-hole|carrier-hole/i.test(role)) return null;
    if (/board|base/i.test(role)) return null;
    if (/clip|lock|paper-fastener/i.test(text)) return 'clip';
    if (/spacer|washer|axle/i.test(text)) return 'spacer';
    if (/gear|ring|sun|planet/i.test(text)) return 'gear';
    if (/cam/i.test(text)) return 'cam';
    if (/guide|bracket|cartridge/i.test(text)) return 'guide';
    if (/follower|slider/i.test(text)) return 'follower';
    if (/rack/i.test(text)) return 'rack';
    return 'linkage';
};

const stackRowsForRecipe = (recipe: FabricationRecipe | undefined): FabricationStackLayer[] => {
    if (!recipe) return [];
    const seen = new Set<string>();
    return recipe.assemblySteps
        .flatMap(step => step.stack ?? [])
        .sort((a, b) => a.order - b.order)
        .flatMap(item => {
            const role = recipeStackRole(item.role, item.label);
            if (!role) return [];
            const key = `${item.order}:${item.label}:${role}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ label: item.label, role, color: STACK_COLORS[role] }];
        });
};

const readableRecipeStackSummary = (recipe: FabricationRecipe | undefined) =>
    recipe ? stackRowsForRecipe(recipe).map(item => fabricationPartDisplayLabel(item.label)).join(' → ') : 'pending recipe';

const camProfilePathD = (samples: number[] | undefined, x: number, y: number, radius: number) => {
    if (!samples?.length) return '';
    const points = Array.from({ length: 48 }, (_, index) => {
        const angle = (index / 48) * Math.PI * 2;
        const rr = radius * sampledCamProfileScale(angle, samples);
        return `${(x + Math.cos(angle) * rr).toFixed(2)} ${(y + Math.sin(angle) * rr).toFixed(2)}`;
    });
    return `M ${points.join(' L ')} Z`;
};

export const makeExplodedStackSvg = (recipe: FabricationRecipe | undefined, esc: (value: unknown) => string) => {
    const stack = stackRowsForRecipe(recipe);
    const base = fabricationBaseLayer();
    const fallbackLayer = (label: string, role: FabricationStackLayer['role']): FabricationStackLayer => ({ label, role, color: STACK_COLORS[role] });
    const rows = stack.length ? stack : [fallbackLayer('Back Clip', 'clip'), fallbackLayer('Input linkage', 'linkage'), fallbackLayer(FABRICATION_SPACER_SPEC.label, 'spacer'), fallbackLayer('Output linkage', 'linkage'), fallbackLayer('Front Clip', 'clip')];
    const shapeFor = (item: FabricationStackLayer, x: number, y: number) => {
        const fill = item.color;
        const stroke = item.role === 'clip' ? '#0f172a' : '#334155';
        if (item.role === 'cam' && recipe?.camProfileSamples?.length) return `<path data-assembly-cam-profile="${esc(recipe.camProfileSamples.join(','))}" d="${camProfilePathD(recipe.camProfileSamples, x + 72, y + 18, 30)}" fill="${fill}" stroke="${stroke}" stroke-width="4"/><circle cx="${x + 72}" cy="${y + 18}" r="8" fill="#fff" stroke="#334155" stroke-width="3"/>`;
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
	<text x="${labelX}" y="${labelY}" class="guide-label">Z+${index + 1} ${esc(fabricationPartDisplayLabel(item.label))}</text>
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
	<text x="22" y="47" class="guide-muted">Stack: listed low-Z board side to high-Z outer side</text>
	<text x="22" y="64" class="guide-muted">Z=0 board · ${recipe ? esc(recipe.mechanismId) : 'pending recipe'}</text>
	</g>
	<g transform="translate(86 426)">
	<rect width="310" height="36" rx="9" fill="${base.color}" stroke="#334155" stroke-width="3"/>
	<text x="18" y="24" class="guide-muted">Z=0 ${esc(base.label)}</text>
	</g>
	<g filter="url(#guide-shadow)">${items}</g>
<line x1="92" y1="458" x2="438" y2="130" stroke="#94a3b8" stroke-width="2" stroke-dasharray="8 10"/>
<text x="70" y="486" class="guide-muted">Board-side washers/spacers keep moving parts clear of the board.</text>
${recipe ? `<text x="40" y="505" class="guide-muted">Recipe: ${esc(recipe.mechanismId)} · ${esc(mechanismTypeLabel(recipe.type))} · anchor ${esc(recipeBoardCallout(recipe))}</text>` : ''}
</svg>`;
};

export const makeAssemblyGuideHtml = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => {
    const esc = (value: unknown) => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
    const firstRecipe = recipes[0];
    const explodedSvg = makeExplodedStackSvg(firstRecipe, esc);
    const showRecipeExplodedViews = recipes.length > 1;
    const recipeSections = recipes.map(recipe => {
        const target = recipeTargetCallout(recipe);
        return `<section>
<h2>${esc(recipe.mechanismId)} · ${esc(mechanismTypeLabel(recipe.type))}</h2>
<p><strong>Board:</strong> ${esc(recipeBoardCallout(recipe))}</p>
${target ? `<p class="target-chip"><strong>Target:</strong> ${esc(target)}</p>` : ''}
${recipe.warnings.length ? `<p><strong>Fix:</strong> ${recipe.warnings.map(esc).join('; ')}</p>` : '<p><strong>OK</strong></p>'}
${showRecipeExplodedViews ? makeExplodedStackSvg(recipe, esc) : ''}
<h3>Required parts</h3><ul>${recipe.requiredParts.map(part => `<li>${esc(fabricationPartDisplayLabel(part.name))} × ${part.quantity}</li>`).join('')}</ul>
<h3>15×15 board kit assembly</h3><ol class="stepper" data-testid="prefab-assembly-steps">${recipe.assemblySteps.map(step => `<li class="assembly-step" style="--i:${step.index}"><strong>${step.index}. ${esc(fabricationPartDisplayLabel(step.label))}</strong><span>${esc(fabricationPartDisplayLabel(step.instruction))}</span><em>${esc(step.role)} · ${esc(readableStepCoordinateCallout(step))} · Z ${step.zMm.toFixed(1)}mm</em></li>`).join('')}</ol>
</section>`;
    }).join('');
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
.target-chip{display:inline-flex;gap:8px;border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;padding:8px 12px;font-weight:850;color:#334155;}
section{break-inside:avoid;margin:18px 0;padding:20px;border:1px solid #dbe3f0;border-radius:22px;background:#fff;box-shadow:0 16px 46px rgba(15,23,42,.06);}
li{margin:.32rem 0;line-height:1.42;}
.stepper{display:grid;gap:10px;padding-left:0;list-style:none}.assembly-step{display:grid;gap:3px;border:1px solid #dbe3f0;border-radius:16px;padding:10px 12px;background:linear-gradient(135deg,#fff,#f8f9ff);animation:step-rise .8s ease both;animation-delay:calc(var(--i) * 90ms)}.assembly-step span{font-weight:750;color:#334155}.assembly-step em{font-style:normal;color:#64748b;font-weight:800;font-size:12px}@keyframes step-rise{from{opacity:.25;transform:translateY(12px)}to{opacity:1;transform:none}}
@media print{body{background:#fff}.page{max-width:none;padding:10mm}.print-actions{display:none}.exploded-guide,section{box-shadow:none}section{page-break-inside:avoid}}
</style></head><body><main class="page"><div class="print-actions"><strong>Printable assembly guide</strong><button onclick="window.print()">Print guide</button></div><h1>${esc(project.metadata.name)} assembly guide</h1><p class="subtitle">Profile ${esc(project.settings.physicalKit.profileKey)} · ${project.settings.physicalKit.gridPitchMm}mm grid · exploded view · cut the Character sheet first.</p>${explodedSvg}${warnings.map(w => `<p class="warning"><strong>Fix:</strong> ${esc(w)}</p>`).join('')}${recipeSections}</main></body></html>`;
};

export const makeAssemblyGuidePdf = (project: ProjectState, recipes: FabricationRecipe[], warnings: string[]) => makeSimplePdf(
    `${project.metadata.name} Printable assembly guide`,
    [
        'Exploded view / Base board below / Module stack low-Z to high-Z',
        'Character sheet: print the 1-2 letter pages from Blueprint before pinning.',
        ...recipes.map(recipe => `Stack ${recipe.mechanismId}: ${readableRecipeStackSummary(recipe)}`),
        'Path projection / Z=0 Base / washer- or spacer-separated moving layers',
        `Profile ${project.settings.physicalKit.profileKey} / ${project.settings.physicalKit.gridPitchMm}mm grid`,
        ...warnings.map(warning => `Warning: ${warning}`),
        ...recipes.flatMap(recipe => [
            `${recipe.mechanismId} / ${mechanismTypeLabel(recipe.type)} / anchor ${recipeBoardCallout(recipe)}`,
            `Target: ${recipeTargetCallout(recipe) || 'none'}`,
            `Required parts: ${recipe.requiredParts.map(part => `${fabricationPartDisplayLabel(part.name)} x ${part.quantity}`).join(', ')}`,
            ...recipe.assemblySteps.map(step => `Kit step ${step.index}: ${fabricationPartDisplayLabel(step.label)} / ${readableStepCoordinateCallout(step)} / Z ${step.zMm.toFixed(1)}mm`)
        ])
    ]
);
