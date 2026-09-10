import type { AppSettings, ProjectState } from '../types';

// The performance preset is a presentation preference: it follows the browser
// session, not the project, so guide/project swaps and reloads must never
// rewrite it. Mirrors restoreAuthoredSettings, which already keeps current
// presentation settings across undo/redo and version restores.
const SESSION_PERFORMANCE_KEY = 'motionsmith.session-performance';
const PRESETS = ['fast', 'balanced', 'high'] as const;

type SessionPerformance = Pick<AppSettings, 'performancePreset'>;

let cached: SessionPerformance | undefined;

const readSessionPerformance = (): SessionPerformance => {
    if (cached) return cached;
    try {
        const raw = window.localStorage.getItem(SESSION_PERFORMANCE_KEY);
        const preset: unknown = raw ? JSON.parse(raw)?.performancePreset : undefined;
        cached = PRESETS.includes(preset as typeof PRESETS[number])
            ? { performancePreset: preset as SessionPerformance['performancePreset'] }
            : { performancePreset: 'balanced' };
    } catch {
        cached = { performancePreset: 'balanced' };
    }
    return cached;
};

/** Overlay the remembered session preset onto any project entering the app. */
export const withSessionPerformance = (project: ProjectState): ProjectState => {
    const session = readSessionPerformance();
    if (session.performancePreset === project.settings.performancePreset) return project;
    return { ...project, settings: { ...project.settings, ...session } };
};

export const rememberSessionPerformance = (preset: AppSettings['performancePreset']) => {
    if (readSessionPerformance().performancePreset === preset) return;
    cached = { performancePreset: preset };
    try {
        window.localStorage.setItem(SESSION_PERFORMANCE_KEY, JSON.stringify(cached));
    } catch {
        // Storage unavailable; the in-memory session value still applies.
    }
};

/** Test seam: drop the cached session value so each test starts cold. */
export const resetSessionPerformanceForTests = () => {
    cached = undefined;
};
