import { strict as assert } from "node:assert";

import { createEmptyProject } from "../utils/project";
import {
    rememberSessionPerformance,
    resetSessionPerformanceForTests,
    withSessionPerformance,
} from "../utils/sessionSettings";

const fakeStorage = () => {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
    };
};

const installWindow = (storage: ReturnType<typeof fakeStorage>) => {
    resetSessionPerformanceForTests();
    (globalThis as Record<string, unknown>).window = { localStorage: storage };
};

// A remembered session preset overlays any freshly loaded project.
installWindow(fakeStorage());
rememberSessionPerformance("high");
assert.equal(withSessionPerformance(createEmptyProject()).settings.performancePreset, "high");

// Matching presets keep project identity (no churn on the editing path).
installWindow(fakeStorage());
rememberSessionPerformance("high");
{
    const project = createEmptyProject();
    const modified = { ...project, settings: { ...project.settings, performancePreset: "high" as const } };
    assert.equal(withSessionPerformance(modified), modified);
}

// Unknown storage content falls back to the default preset.
installWindow(fakeStorage());
assert.equal(withSessionPerformance(createEmptyProject()).settings.performancePreset, "balanced");

console.log("session performance persistence ok");
