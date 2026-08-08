import type { MechanismConfig, PhysicalKitSettings } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';
import { fabricationLinkageSpecForSceneLength } from './fabricationStackModel';
import { calculateLinkage, camProfileSmoothnessWarning } from './kinematics';
import { REFERENCE_DEFAULTS } from './mechanismReference';
import { MECHANISM_BINDING_BLOCKER } from './pathTargets';

export type FabricationFeasibleRange = {
    percentValid: number;
    startDeg: number;
    endDeg: number;
    intervals: Array<{ startDeg: number; endDeg: number }>;
    warning: string | null;
};

export const sampleFeasibleRange = (
    mechanism: MechanismConfig,
    samples = 96,
    kit?: PhysicalKitSettings,
): FabricationFeasibleRange => {
    const profileWarning = mechanism.type === 'cam'
        ? camProfileSmoothnessWarning(mechanism.camProfileSamples)
        : null;
    let valid = 0;
    const validSamples: boolean[] = [];
    const loops = mechanism.type === '5bar' || mechanism.type === '6bar' || mechanism.type === 'planetary_gear' ? 8 : 1;
    const baseSamples = Math.max(1, Math.round(samples));
    const totalSamples = baseSamples * loops;
    for (let i = 0; i <= totalSamples; i++) {
        const angle = (i / totalSamples) * Math.PI * 2;
        validSamples[i] = calculateLinkage(mechanism, angle, kit).isValid;
        if (validSamples[i]) valid++;
    }
    const intervals: Array<{ startDeg: number; endDeg: number }> = [];
    let start: number | null = null;
    validSamples.forEach((ok, i) => {
        if (ok && start === null) start = i;
        if ((!ok || i === totalSamples) && start !== null) {
            const end = ok && i === totalSamples ? i : i - 1;
            intervals.push({ startDeg: Math.round(start * 360 / totalSamples), endDeg: Math.round(end * 360 / totalSamples) });
            start = null;
        }
    });
    const intervalText = intervals.map(i => `${i.startDeg}°–${i.endDeg}°`).join(', ');
    return {
        percentValid: valid / (totalSamples + 1),
        startDeg: intervals[0]?.startDeg ?? 0,
        endDeg: intervals.at(-1)?.endDeg ?? 0,
        intervals,
        warning: profileWarning ?? (valid === totalSamples + 1 ? null : valid === 0 ? 'No motion' : `Motion ${Math.round((valid / (totalSamples + 1)) * 100)}% · ${intervalText}`)
    };
};
export const compactStudentActionForFabricationDiagnostic = (
    diagnostic: string | null | undefined,
): string | null => {
    if (!diagnostic) return null;
    const text = diagnostic.trim();
    const action: string | null = (() => {
        if (/^Fix:\s*Choose anchor\.?$/i.test(text)) return MECHANISM_BINDING_BLOCKER;
        if (/^Fix:\s*/i.test(text)) {
            const fix = compactStudentActionForFabricationDiagnostic(text.replace(/^Fix:\s*/i, ''));
            return fix?.startsWith('Fix ') ? fix : fix ? `Fix: ${fix.replace(/[.]$/, '')}.` : null;
        }
        if (/^No motion\b/i.test(text)) return 'No full motion. Try reset or smaller links.';
        if (/^Motion \d+%(?:\s|$)/i.test(text)) return 'Motion may jam. Try a smaller move.';
        if (/mechanisms? collide|collision/i.test(text)) return 'Move one mechanism. Mechanisms collide.';
        if (/outside sheet|off[- ]sheet|off board|outside board|placement off board/i.test(text)) return 'Fit inside board.';
        if (/choose another target|duplicate target|target.+(?:used|occupied)/i.test(text)) return 'Choose another target.';
        if (/choose (?:this target's )?path|missing path|no path/i.test(text)) return 'Choose a path.';
        if (/choose a target|missing target|no target/i.test(text)) return 'Choose a target.';
        if (/no active mechanism/i.test(text)) return 'Add a mechanism.';
        if (/physical envelope incomplete/i.test(text)) return 'Fit mechanism parts.';
        if (/not fabrication-ready|fabrication unsupported/i.test(text)) return 'Choose a buildable mechanism.';
        if (/fix mechanism geometry/i.test(text)) return 'Fix mechanism geometry.';
        if (/graph invalid|graph fabrication blocked|constraint|validation|\bscore\b|[_()[\]{}]/i.test(text)) {
            return 'Fix mechanism setup.';
        }
        return text;
    })();
    return action && action.length > 90 ? `${action.slice(0, 87).trimEnd()}...` : action;
};

const normalizeReadinessBlocker = (diagnostic: string | null | undefined) => {
  const compact = compactStudentActionForFabricationDiagnostic(diagnostic);
  if (!compact) return null;
  const withoutFix = compact.replace(/^Fix:\s*/i, "").trim();
  return withoutFix;
};

export const isSoftReadinessBlocker = (
  diagnostic: string | null | undefined,
): boolean => {
  const normalized = normalizeReadinessBlocker(diagnostic);
  if (!normalized) return false;
  return [
    /^Fit mechanism parts\.?$/i,
    /^Motion may jam\./i,
    /^No full motion\./i,
  ].some((pattern) => pattern.test(normalized));
};

export const hasHardReadinessBlockers = (
  blockers: readonly string[],
): boolean => blockers.some((blocker) => !isSoftReadinessBlocker(blocker));

export const physicalTolerance = (value: number) => Math.max(1, Math.abs(value) * 0.03);

export const closePhysicalValue = (actual: number, expected: number) =>
    Math.abs(actual - expected) <= physicalTolerance(expected || actual || 1);

export const closeToBoardPitch = (sceneLength: number, pitchMm: number = REFERENCE_DEFAULTS.pitchMm) => {
    const pitch = pitchMm * SCENE_PX_PER_MM;
    const cells = Math.max(1, Math.round(Math.abs(sceneLength) / Math.max(1, pitch)));
    return closePhysicalValue(Math.abs(sceneLength), cells * pitch);
};

export const closeToFabricationLinkage = (sceneLength: number, minHoleCount = 2, pitchMm: number = REFERENCE_DEFAULTS.pitchMm) => {
    const spec = fabricationLinkageSpecForSceneLength(sceneLength, pitchMm, minHoleCount);
    return closePhysicalValue(Math.abs(sceneLength), spec.lengthMm * SCENE_PX_PER_MM);
};
