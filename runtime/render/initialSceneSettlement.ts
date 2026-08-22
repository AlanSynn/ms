import type { RenderPerformancePreset } from "../../utils/renderPerformancePolicy";

export type InitialTopologyBatchPolicy = {
  readonly maxItemsPerFrame: number;
  readonly frameBudgetMs: number;
  readonly interBatchDelayFrames: number;
};

const PUPPET_INITIAL_TOPOLOGY_POLICY: Readonly<
  Record<RenderPerformancePreset, InitialTopologyBatchPolicy>
> = Object.freeze({
  fast: Object.freeze({
    maxItemsPerFrame: 1,
    frameBudgetMs: 4,
    interBatchDelayFrames: 1,
  }),
  balanced: Object.freeze({
    maxItemsPerFrame: 1,
    frameBudgetMs: 4,
    interBatchDelayFrames: 1,
  }),
  high: Object.freeze({
    maxItemsPerFrame: 1,
    frameBudgetMs: 4,
    interBatchDelayFrames: 1,
  }),
});

export const puppetInitialTopologyBatchPolicy = (
  preset: RenderPerformancePreset,
): InitialTopologyBatchPolicy => PUPPET_INITIAL_TOPOLOGY_POLICY[preset];

export type PuppetInitialTopologyPhase =
  | "base"
  | "outline"
  | "art"
  | "hardware"
  | "complete";

export type PuppetInitialTopologySettlementStep<Item> = {
  readonly item: Item;
  readonly phase: PuppetInitialTopologyPhase;
  readonly finalForPart: boolean;
};

/**
 * The first cold part introduces the scene's material/program variants. Split
 * that prefix across submitted frames; later parts retain the bounded one-part
 * batch so readiness does not grow linearly with visual sublayers.
 */
export const puppetInitialTopologySettlementSteps = <Item>(
  items: readonly Item[],
  firstPart: {
    readonly hasOutline: boolean;
    readonly hasArt: boolean;
    readonly hasHardware: boolean;
  },
  splitFirstPart: boolean,
): readonly PuppetInitialTopologySettlementStep<Item>[] => {
  if (!splitFirstPart || items.length === 0) {
    return items.map((item) => ({
      item,
      phase: "complete" as const,
      finalForPart: true,
    }));
  }
  const firstPhases: PuppetInitialTopologyPhase[] = ["base"];
  if (firstPart.hasOutline) firstPhases.push("outline");
  if (firstPart.hasArt) firstPhases.push("art");
  if (firstPart.hasHardware) firstPhases.push("hardware");
  return [
    ...firstPhases.map((phase, index) => ({
      item: items[0],
      phase,
      finalForPart: index === firstPhases.length - 1,
    })),
    ...items.slice(1).map((item) => ({
      item,
      phase: "complete" as const,
      finalForPart: true,
    })),
  ];
};

export type FoundryInitialTopologySettlementStep = {
  readonly visibleLayerCount: number;
  readonly visiblePinStackCount: number;
  readonly complete: boolean;
};

export type FoundryInitialShaderSettlementStep = {
  readonly gridLines: boolean;
  readonly workSurface: boolean;
  readonly complete: boolean;
};

/**
 * Keep the cold line and lit-surface programs on separate submissions. The
 * second step is the exact static scene used after settlement.
 */
export const foundryInitialShaderSettlementSteps = ():
  readonly FoundryInitialShaderSettlementStep[] => [
    { gridLines: true, workSurface: false, complete: false },
    { gridLines: true, workSurface: true, complete: true },
  ];

/**
 * Grow one exact Foundry topology slice per submitted frame. Each step is a
 * prefix of the canonical render plan, so the last step is byte-for-byte the
 * same geometry path as an ordinary retained-scene render.
 */
export const foundryInitialTopologySettlementSteps = (
  layerCount: number,
  pinStackCount: number,
): readonly FoundryInitialTopologySettlementStep[] => {
  const layers = Math.max(0, Math.floor(layerCount));
  const pins = Math.max(0, Math.floor(pinStackCount));
  const steps: FoundryInitialTopologySettlementStep[] = [];

  for (let visibleLayerCount = 1; visibleLayerCount <= layers; visibleLayerCount += 1) {
    steps.push({
      visibleLayerCount,
      visiblePinStackCount: 0,
      complete: false,
    });
  }
  for (let visiblePinStackCount = 1; visiblePinStackCount <= pins; visiblePinStackCount += 1) {
    steps.push({
      visibleLayerCount: layers,
      visiblePinStackCount,
      complete: false,
    });
  }
  if (steps.length === 0) {
    steps.push({
      visibleLayerCount: 0,
      visiblePinStackCount: 0,
      complete: true,
    });
  } else {
    const last = steps[steps.length - 1];
    steps[steps.length - 1] = { ...last, complete: true };
  }
  return steps;
};

export type KeyedInitialTopologySettlementResult =
  | "started"
  | "updated"
  | "restarted";

export type KeyedInitialTopologySettlementSnapshot = {
  readonly active: boolean;
  readonly activeKey: string | null;
  readonly generationsStarted: number;
  readonly sameKeyUpdates: number;
  readonly generationsRestarted: number;
  readonly generationsCancelled: number;
  readonly stepsDelivered: number;
  readonly generationsCompleted: number;
};

export type KeyedInitialTopologySettlement<Frame, Step> = {
  readonly update: (
    key: string,
    frame: Frame,
    steps: readonly Step[],
  ) => KeyedInitialTopologySettlementResult;
  readonly cancel: () => boolean;
  readonly isActive: () => boolean;
  readonly activeKey: () => string | null;
  readonly snapshot: () => KeyedInitialTopologySettlementSnapshot;
};

/**
 * Own one incremental topology generation independently from React render
 * effects. Same-topology frames only replace the payload consumed by later
 * scheduler steps; a different key cancels the old generation before it can
 * publish stale work.
 */
export const createKeyedInitialTopologySettlement = <Frame, Step>({
  schedule,
  onStart,
  onStep,
  onComplete,
  onCancel,
}: {
  schedule: (
    steps: readonly Step[],
    visit: (step: Step) => void,
    complete: () => void,
  ) => () => void;
  onStart?: (frame: Frame, key: string) => void;
  onStep: (step: Step, frame: Frame, key: string) => void;
  onComplete: (frame: Frame, key: string) => void;
  onCancel?: (key: string) => void;
}): KeyedInitialTopologySettlement<Frame, Step> => {
  type Generation = {
    key: string;
    latestFrame: Frame;
    cancelScheduledWork: () => void;
  };

  let active: Generation | null = null;
  let generationsStarted = 0;
  let sameKeyUpdates = 0;
  let generationsRestarted = 0;
  let generationsCancelled = 0;
  let stepsDelivered = 0;
  let generationsCompleted = 0;

  const cancel = () => {
    const generation = active;
    if (!generation) return false;
    active = null;
    generationsCancelled += 1;
    generation.cancelScheduledWork();
    onCancel?.(generation.key);
    return true;
  };

  const update = (
    key: string,
    frame: Frame,
    steps: readonly Step[],
  ): KeyedInitialTopologySettlementResult => {
    if (active?.key === key) {
      active.latestFrame = frame;
      sameKeyUpdates += 1;
      return "updated";
    }

    const restarted = cancel();
    generationsStarted += 1;
    if (restarted) generationsRestarted += 1;
    const generation: Generation = {
      key,
      latestFrame: frame,
      cancelScheduledWork: () => undefined,
    };
    active = generation;
    onStart?.(frame, key);
    generation.cancelScheduledWork = schedule(
      steps,
      (step) => {
        if (active !== generation) return;
        stepsDelivered += 1;
        onStep(step, generation.latestFrame, generation.key);
      },
      () => {
        if (active !== generation) return;
        active = null;
        generationsCompleted += 1;
        onComplete(generation.latestFrame, generation.key);
      },
    );
    return restarted ? "restarted" : "started";
  };

  return {
    update,
    cancel,
    isActive: () => active !== null,
    activeKey: () => active?.key ?? null,
    snapshot: () => ({
      active: active !== null,
      activeKey: active?.key ?? null,
      generationsStarted,
      sameKeyUpdates,
      generationsRestarted,
      generationsCancelled,
      stepsDelivered,
      generationsCompleted,
    }),
  };
};
