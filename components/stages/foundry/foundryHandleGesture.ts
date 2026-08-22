import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from '../../../types';
import { boardToScene, sceneToBoard } from '../../../utils/coordinates';
import type { MechanismPreviewSimulation } from '../../../utils/mechanismPreview';
import type { PlaybackClock } from '../../../runtime/playback/externalPlaybackClock';
import { clampMechanismParam } from '../mechanism/mechanismParamPolicy';

export type FoundryGestureHandleId = 'M' | 'A' | 'B' | 'C' | 'D';

export type FoundryGestureCommitFrameScheduler = {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
};

const browserCommitFrameScheduler: FoundryGestureCommitFrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

export const createPostPaintFoundryGestureCommit = <Snapshot>(
  scheduler: FoundryGestureCommitFrameScheduler = browserCommitFrameScheduler,
) => {
  let generation = 0;
  let firstFrame: number | undefined;
  let secondFrame: number | undefined;
  let pendingRelease: (() => void) | undefined;

  const cancelFrames = () => {
    if (firstFrame !== undefined) scheduler.cancelFrame(firstFrame);
    if (secondFrame !== undefined) scheduler.cancelFrame(secondFrame);
    firstFrame = undefined;
    secondFrame = undefined;
  };

  const cancel = () => {
    const hadPendingRelease = pendingRelease !== undefined;
    generation += 1;
    cancelFrames();
    pendingRelease = undefined;
    return hadPendingRelease;
  };

  const schedule = (
    snapshot: Snapshot,
    callbacks: {
      present(snapshot: Snapshot): void;
      commit(snapshot: Snapshot): void;
      release(): void;
    },
  ) => {
    cancel();
    const scheduledGeneration = generation;
    pendingRelease = callbacks.release;
    firstFrame = scheduler.requestFrame(() => {
      if (scheduledGeneration !== generation) return;
      firstFrame = undefined;
      secondFrame = scheduler.requestFrame(() => {
        if (scheduledGeneration !== generation) return;
        secondFrame = undefined;
        const release = pendingRelease;
        pendingRelease = undefined;
        release?.();
      });
    });
    callbacks.present(snapshot);
    callbacks.commit(snapshot);
  };

  return {
    schedule,
    cancel,
    dispose: cancel,
    hasPending: () => pendingRelease !== undefined,
  };
};

export const shouldCommitFoundryGesture = (
  eventType: string,
  dirty: boolean,
) => dirty && eventType !== 'pointercancel';

export const shouldForceFirstFoundryGestureMove = (dirty: boolean) => !dirty;

export const captureFoundryGesturePlayback = <Simulation>(
  clock: Pick<PlaybackClock, 'getPhase' | 'stop'>,
  sample: (phase: number) => Simulation,
) => {
  const phase = clock.getPhase();
  clock.stop();
  return { phase, simulation: sample(phase) };
};

export const settleExternalFoundryFrame = <Frame>(
  controller: {
    isActive(): boolean;
    cancel(): unknown;
    restoreAndRelease(frame: Frame): void;
  },
  hasRenderedGestureDraft: boolean,
  canonicalFrame: Frame,
) => {
  if (!controller.isActive()) return 'inactive' as const;
  if (hasRenderedGestureDraft) {
    controller.cancel();
    return 'cancelled-for-react-release' as const;
  }
  controller.restoreAndRelease(canonicalFrame);
  return 'restored-canonical' as const;
};

export const retainFoundryGestureAnalysis = <Analysis>(
  gestureActive: boolean,
  retained: { current: Analysis | null },
  calculate: () => Analysis,
) => {
  if (gestureActive && retained.current !== null) return retained.current;
  const analysis = calculate();
  retained.current = analysis;
  return analysis;
};

export const isExpectedFoundryGestureProjectChange = <Snapshot>(
  hasPendingRelease: boolean,
  expectedCommit: Snapshot | null,
  committed: Snapshot,
) =>
  hasPendingRelease &&
  expectedCommit !== null &&
  expectedCommit === committed;

type FoundryHandleGestureInput = {
  mechanism: MechanismConfig;
  handle: FoundryGestureHandleId;
  point: Point;
  simulation: Pick<MechanismPreviewSimulation, 'state' | 'scale'>;
  landing: Point;
  kit: PhysicalKitSettings;
};

export const foundryMechanismForHandleGesture = ({
  mechanism,
  handle,
  point,
  simulation,
  landing,
  kit,
}: FoundryHandleGestureInput): MechanismConfig => {
  const state = simulation.state;
  const scale = Math.max(0.001, simulation.scale);
  const sceneDistance = (a: Point, b: Point) =>
    Math.hypot(a.x - b.x, a.y - b.y) / scale;

  if (handle === 'M') {
    const unsnapped = {
      x: landing.x + (point.x - state.p1.x) / scale,
      y: landing.y - (point.y - state.p1.y) / scale,
    };
    const board = sceneToBoard(unsnapped, kit);
    const snapped = boardToScene(board.col, board.row, kit);
    return {
      ...mechanism,
      anchorX: snapped.x,
      anchorY: snapped.y,
      sceneAnchor: snapped,
      transform: {
        ...(mechanism.transform ?? {
          x: snapped.x,
          y: snapped.y,
          rotation: mechanism.groundAngle ?? 0,
          scale: 1,
        }),
        x: snapped.x,
        y: snapped.y,
      },
    };
  }
  if (handle === 'B') {
    return {
      ...mechanism,
      crankLength: clampMechanismParam(
        'crankLength',
        sceneDistance(state.p1, point),
      ),
    };
  }
  if (handle === 'D') {
    const proposedLength = clampMechanismParam(
      'groundLength',
      sceneDistance(state.p1, point),
    );
    const proposedAngle =
      (Math.atan2(point.y - state.p1.y, point.x - state.p1.x) * 180) /
      Math.PI;
    const proposedRadians = (proposedAngle * Math.PI) / 180;
    const proposedFixedPivot = {
      x: landing.x + proposedLength * Math.cos(proposedRadians),
      y: landing.y + proposedLength * Math.sin(proposedRadians),
    };
    const board = sceneToBoard(proposedFixedPivot, kit);
    const fixedPivot = boardToScene(board.col, board.row, kit);
    const fixedDx = fixedPivot.x - landing.x;
    const fixedDy = fixedPivot.y - landing.y;
    return {
      ...mechanism,
      groundLength: clampMechanismParam(
        'groundLength',
        Math.hypot(fixedDx, fixedDy),
      ),
      groundAngle:
        (Math.atan2(fixedDy, fixedDx) * 180) / Math.PI,
    };
  }
  return {
    ...mechanism,
    couplerLength: clampMechanismParam(
      'couplerLength',
      sceneDistance(state.j1, point),
    ),
    rockerLength: clampMechanismParam(
      'rockerLength',
      sceneDistance(state.p2, point),
    ),
  };
};
