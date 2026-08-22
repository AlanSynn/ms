import { useEffect, type ComponentProps } from "react";

import type { AppStage } from "../types";
import { preloadThreeFoundryPreview } from "./stages/foundry/DeferredThreeFoundryPreview";

type AssemblyModule = typeof import("./stages/assembly/AssemblyGuide");
type BlueprintModule = typeof import("./stages/blueprint/BlueprintExport");
type FoundryModule = typeof import("./stages/foundry/MechanismFoundry");
type DesignModule = typeof import("./stages/mechanism/MechanismDesign");
type OptionsModule = typeof import("./stages/options/Options");
type PathModule = typeof import("./stages/path/PathEditor");

export type ClassroomStagePreloadReadiness =
  | "waiting"
  | "ready"
  | "safe-fallback";

export type ClassroomStageReadinessSignals = {
  rendererExpected: boolean;
  rendererStatus: string | null;
  authoritativeRendererReady: boolean;
  emptyStage: boolean;
  previewLoadFailed: boolean;
};

export const classifyClassroomStagePreloadReadiness = (
  signals: ClassroomStageReadinessSignals,
): ClassroomStagePreloadReadiness => {
  if (signals.emptyStage || !signals.rendererExpected) return "safe-fallback";
  if (signals.previewLoadFailed) return "safe-fallback";
  if (signals.rendererStatus === "unavailable") return "safe-fallback";
  if (
    signals.rendererStatus !== "webgl" ||
    !signals.authoritativeRendererReady
  ) {
    return "waiting";
  }
  return "ready";
};

export const mayStartAdjacentStagePreload = (
  readiness: ClassroomStagePreloadReadiness,
  safeFallbackDelayElapsed: boolean,
) => readiness === "ready" ||
  (readiness === "safe-fallback" && safeFallbackDelayElapsed);

const PUPPET_PREVIEW_BY_STAGE: Partial<Record<AppStage, string>> = {
  character: "character-three-puppet",
  path: "path-three-puppet",
  blueprint: "blueprint-three-puppet",
};

const SAFE_FALLBACK_DELAY_MS = 1_000;

const readActiveStagePreloadReadiness = (
  stage: AppStage,
): ClassroomStagePreloadReadiness => {
  const stageRoot = document.querySelector<HTMLElement>(
    `[data-stage="${stage}"]`,
  );
  const emptySelector = stage === "design"
    ? '[data-testid="design-shared-foundry-empty"]'
    : stage === "assembly"
      ? '[data-testid="assembly-canvas-preview"] .blueprint-empty-state'
      : null;
  const emptyStage = emptySelector !== null && Boolean(
    stageRoot?.querySelector(emptySelector),
  );
  const previewLoadFailed = Boolean(
    stageRoot?.querySelector('[data-preview-load-state="failed"]'),
  );
  const puppetTestId = PUPPET_PREVIEW_BY_STAGE[stage];
  const preview = puppetTestId
    ? stageRoot?.querySelector<HTMLElement>(`[data-testid="${puppetTestId}"]`)
    : stageRoot?.querySelector<HTMLElement>('[data-testid="foundry-preview"]');
  return classifyClassroomStagePreloadReadiness({
    rendererExpected: stage !== "options",
    rendererStatus: preview?.getAttribute("data-three-renderer-status") ?? null,
    authoritativeRendererReady: puppetTestId
      ? preview?.getAttribute("data-three-initial-scene-ready") === "true"
      : preview?.getAttribute("data-three-topology-ready") === "true",
    emptyStage,
    previewLoadFailed,
  });
};

export const useAdjacentClassroomStagePreload = (
  mountedStage: AppStage | null,
  suspendStageContent: boolean,
) => {
  useEffect(() => {
    if (
      suspendStageContent ||
      mountedStage === null ||
      mountedStage === "options"
    ) return;
    const host = window as typeof window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let active = true;
    let gateReleased = false;
    let readinessObserver: MutationObserver | undefined;
    let safeFallbackHandle: number | undefined;
    let idleHandle: number | undefined;
    let idleTimeoutHandle: number | undefined;
    const tasks: Array<() => Promise<unknown>> = [
      () => preloadNextClassroomStage(mountedStage),
    ];
    if (mountedStage === "path") {
      // This is the renderer dependency of the same adjacent Foundry stage,
      // not a second stage-ahead preload.
      tasks.push(preloadThreeFoundryPreview);
    }
    const scheduleNext = () => {
      if (!active || tasks.length === 0) return;
      const runOne = () => {
        idleHandle = undefined;
        idleTimeoutHandle = undefined;
        const task = tasks.shift();
        if (!active || !task) return;
        void task().catch(() => undefined).finally(scheduleNext);
      };
      if (host.requestIdleCallback) {
        idleHandle = host.requestIdleCallback(runOne, { timeout: 1_000 });
      } else {
        idleTimeoutHandle = window.setTimeout(runOne, 250);
      }
    };
    const releaseGate = (
      readiness: ClassroomStagePreloadReadiness,
      safeFallbackDelayElapsed: boolean,
    ) => {
      if (
        !active ||
        gateReleased ||
        !mayStartAdjacentStagePreload(readiness, safeFallbackDelayElapsed)
      ) return;
      gateReleased = true;
      readinessObserver?.disconnect();
      if (safeFallbackHandle !== undefined) {
        window.clearTimeout(safeFallbackHandle);
        safeFallbackHandle = undefined;
      }
      scheduleNext();
    };
    const evaluateReadiness = () => {
      if (!active || gateReleased) return;
      const readiness = readActiveStagePreloadReadiness(mountedStage);
      if (readiness === "ready") {
        releaseGate(readiness, false);
        return;
      }
      if (readiness === "safe-fallback") {
        safeFallbackHandle ??= window.setTimeout(() => {
          safeFallbackHandle = undefined;
          const current = readActiveStagePreloadReadiness(mountedStage);
          releaseGate(current, true);
        }, SAFE_FALLBACK_DELAY_MS);
        return;
      }
      if (safeFallbackHandle !== undefined) {
        window.clearTimeout(safeFallbackHandle);
        safeFallbackHandle = undefined;
      }
    };
    readinessObserver = new MutationObserver(evaluateReadiness);
    readinessObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        "class",
        "data-stage",
        "data-testid",
        "data-preview-load-state",
        "data-three-initial-scene-ready",
        "data-three-renderer-status",
        "data-three-topology-ready",
      ],
    });
    evaluateReadiness();
    return () => {
      active = false;
      readinessObserver?.disconnect();
      if (safeFallbackHandle !== undefined) {
        window.clearTimeout(safeFallbackHandle);
      }
      if (idleHandle !== undefined) host.cancelIdleCallback?.(idleHandle);
      if (idleTimeoutHandle !== undefined) {
        window.clearTimeout(idleTimeoutHandle);
      }
    };
  }, [mountedStage, suspendStageContent]);
};

let assemblyPromise: Promise<AssemblyModule> | undefined;
let blueprintPromise: Promise<BlueprintModule> | undefined;
let foundryPromise: Promise<FoundryModule> | undefined;
let designPromise: Promise<DesignModule> | undefined;
let optionsPromise: Promise<OptionsModule> | undefined;
let pathPromise: Promise<PathModule> | undefined;
let assemblyModule: AssemblyModule | undefined;
let blueprintModule: BlueprintModule | undefined;
let foundryModule: FoundryModule | undefined;
let designModule: DesignModule | undefined;
let optionsModule: OptionsModule | undefined;
let pathModule: PathModule | undefined;

const loadAssembly = () => {
  assemblyPromise ??= import("./stages/assembly/AssemblyGuide")
    .then((module) => assemblyModule = module)
    .catch((error) => {
      assemblyPromise = undefined;
      throw error;
    });
  return assemblyPromise;
};
const loadBlueprint = () => {
  blueprintPromise ??= import("./stages/blueprint/BlueprintExport")
    .then((module) => blueprintModule = module)
    .catch((error) => {
      blueprintPromise = undefined;
      throw error;
    });
  return blueprintPromise;
};
const loadFoundry = () => {
  foundryPromise ??= import("./stages/foundry/MechanismFoundry")
    .then((module) => foundryModule = module)
    .catch((error) => {
      foundryPromise = undefined;
      throw error;
    });
  return foundryPromise;
};
const loadDesign = () => {
  designPromise ??= import("./stages/mechanism/MechanismDesign")
    .then((module) => designModule = module)
    .catch((error) => {
      designPromise = undefined;
      throw error;
    });
  return designPromise;
};
const loadOptions = () => {
  optionsPromise ??= import("./stages/options/Options")
    .then((module) => optionsModule = module)
    .catch((error) => {
      optionsPromise = undefined;
      throw error;
    });
  return optionsPromise;
};
const loadPath = () => {
  pathPromise ??= import("./stages/path/PathEditor")
    .then((module) => pathModule = module)
    .catch((error) => {
      pathPromise = undefined;
      throw error;
    });
  return pathPromise;
};

const AssemblyStage = (
  props: ComponentProps<AssemblyModule["AssemblyGuide"]>,
) => {
  if (!assemblyModule) throw loadAssembly();
  const Component = assemblyModule.AssemblyGuide;
  return <Component {...props} />;
};

const BlueprintStage = (
  props: ComponentProps<BlueprintModule["BlueprintExport"]>,
) => {
  if (!blueprintModule) throw loadBlueprint();
  const Component = blueprintModule.BlueprintExport;
  return <Component {...props} />;
};

const FoundryStage = (
  props: ComponentProps<FoundryModule["MechanismFoundry"]>,
) => {
  if (!foundryModule) throw loadFoundry();
  const Component = foundryModule.MechanismFoundry;
  return <Component {...props} />;
};

const DesignStage = (
  props: ComponentProps<DesignModule["MechanismDesign"]>,
) => {
  if (!designModule) throw loadDesign();
  const Component = designModule.MechanismDesign;
  return <Component {...props} />;
};

const OptionsStage = (
  props: ComponentProps<OptionsModule["Options"]>,
) => {
  if (!optionsModule) throw loadOptions();
  const Component = optionsModule.Options;
  return <Component {...props} />;
};

const PathStage = (
  props: ComponentProps<PathModule["PathEditor"]>,
) => {
  if (!pathModule) throw loadPath();
  const Component = pathModule.PathEditor;
  return <Component {...props} />;
};

export const preloadNextClassroomStage = (stage: AppStage) => {
  switch (stage) {
    case "character":
      return loadPath();
    case "path":
      return loadFoundry();
    case "foundry":
      return loadDesign();
    case "design":
      return loadBlueprint();
    case "blueprint":
      return loadAssembly();
    case "assembly":
      return loadOptions();
    case "options":
      return Promise.resolve();
  }
};

export const resolveAssemblyStage = () =>
  AssemblyStage;
export const resolveBlueprintStage = () =>
  BlueprintStage;
export const resolveFoundryStage = () =>
  FoundryStage;
export const resolveDesignStage = () =>
  DesignStage;
export const resolveOptionsStage = () => OptionsStage;
export const resolvePathStage = () => PathStage;
