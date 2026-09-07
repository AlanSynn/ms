import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { subscribeCadencedPlaybackSampler } from "../runtime/playback/cadencedPlaybackSampler";
import { createPlaybackClock } from "../runtime/playback/externalPlaybackClock";
import { motionPreviewForPath, preferredMotionJointId } from "../utils/motion";
import { createLessonProject } from "../utils/project";

let now = 0;
let nextHandle = 1;
const pending = new Map<number, (time: number) => void>();
const scheduler = {
  now: () => now,
  requestFrame: (callback: (time: number) => void) => {
    const handle = nextHandle++;
    pending.set(handle, callback);
    return handle;
  },
  cancelFrame: (handle: number) => pending.delete(handle),
};

const advanceTo = (time: number) => {
  now = time;
  const callbacks = [...pending.values()];
  pending.clear();
  callbacks.forEach((callback) => callback(time));
};

const clock = createPlaybackClock(scheduler);
const frames: Array<{ phase: number; elapsedMs: number }> = [];
clock.subscribe((frame) => frames.push({ phase: frame.phase, elapsedMs: frame.elapsedMs }));
clock.start({
  initialPhase: 0,
  advancePhase: (elapsedMs, phase) => phase + elapsedMs / 1000,
});
advanceTo(16);
advanceTo(32);
assert.equal(frames.length, 2, "the external clock emits one frame per scheduled RAF");
assert.equal(frames[0]?.elapsedMs, 16, "clock elapsed time is measured from the prior frame");
assert.equal(clock.getPhase(), 0.032, "clock phase advances without React state");
clock.setPhase(-Math.PI / 2);
assert(Math.abs(clock.getPhase() - (Math.PI * 1.5)) < 1e-12, "manual phase writes wrap into one turn");
clock.stop();
assert.equal(pending.size, 0, "stopping the clock cancels its pending RAF");

const pathProject = createLessonProject("waving-arm");
const path = pathProject.paths[pathProject.selectedPathId ?? ""];
const mechanism = pathProject.mechanisms[0];
assert(path && mechanism, "the playback fixture includes the selected hand path and its mechanism");
const targetJointId = preferredMotionJointId(
  pathProject,
  path.partId,
  mechanism.targetAnchorJointId ?? path.targetAnchorJointId,
  { preferDistalWhenRoot: !path.targetAnchorJointId },
);
const pathClock = createPlaybackClock(scheduler);
const appliedPathTargets: Array<{ x: number; y: number }> = [];
let pathPlaybackEnabled = false;
const unsubscribePath = subscribeCadencedPlaybackSampler({
  clock: pathClock,
  minFrameIntervalMs: 25,
  sampleInitial: false,
  sample: (phase) => pathPlaybackEnabled
    ? motionPreviewForPath(pathProject, path, phase, targetJointId)
    : undefined,
  apply: (preview) => {
    assert(preview.skeleton, "Path playback delivers the animated skeleton");
    assert(Object.keys(preview.parts).length > 0, "Path playback delivers animated character parts");
    assert(preview.target, "Path playback delivers the selected path target");
    appliedPathTargets.push(preview.target);
  },
});
assert.equal(
  appliedPathTargets.length,
  0,
  "the persistent Path sampler stays idle while its shared clock is stopped",
);
pathClock.setPhase(0.25);
assert.equal(
  appliedPathTargets.length,
  0,
  "an idle Path scrub leaves rendering to the canonical React angle update instead of double-submitting",
);
pathPlaybackEnabled = true;
pathClock.start({
  initialPhase: 0,
  advancePhase: (elapsedMs, previousPhase) => previousPhase + elapsedMs / 250,
});
for (const time of [48, 64, 80, 96, 112, 128]) advanceTo(time);
pathClock.stop();
unsubscribePath();
assert(
  appliedPathTargets.length >= 3,
  "starting the shared clock after Path subscribes produces cadenced preview frames",
);
assert(
  appliedPathTargets.some((target, index) => {
    const previous = appliedPathTargets[index - 1];
    return previous && Math.hypot(target.x - previous.x, target.y - previous.y) > 1e-6;
  }),
  "Path playback advances the canonical hand target instead of resubmitting a static frame",
);
assert.equal(pending.size, 0, "stopping Path playback releases its scheduled frame");

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");
const playbackHook = source("hooks/useWorkspacePlaybackLoop.ts");
const puppetPreview = source("components/ThreePuppetPreview.tsx");
const pathCanvasPane = source("components/stages/path/PathCanvasPane.tsx");
const pathEditor = source("components/stages/path/PathEditor.tsx");
const externalClock = source("runtime/playback/externalPlaybackClock.ts");
const foundryPreview = source("components/stages/foundry/ThreeFoundryPreview.tsx");
const foundryOverlay = source("components/stages/foundry/FoundryOverlayLayer.tsx");
const playerDock = source("components/shell/WorkspacePlayerDock.tsx");

assert(playbackHook.includes("playbackClock.start") && !playbackHook.includes("requestAnimationFrame("), "the workspace hook delegates scheduling to the external clock");
assert(!playbackHook.includes("setAngle("), "the workspace frame driver does not enqueue React phase state");
assert(puppetPreview.includes("subscribeCadencedPlaybackSampler") && puppetPreview.includes("partMeshesRef.current"), "the 3D puppet preview updates retained transforms from the cadenced external clock");
assert(foundryPreview.includes("subscribeCadencedPlaybackSampler") && foundryPreview.includes("renderDynamicRef"), "the shared Foundry renderer consumes cadenced playback outside React");
assert(foundryOverlay.includes("subscribeCadencedPlaybackSampler") && foundryOverlay.includes("foundry-velocity-vector") && foundryOverlay.includes("setAttribute"), "the Foundry SVG physics overlay updates existing nodes directly from the cadenced external clock");
assert(playerDock.includes("time - lastControlUpdate < 100"), "the playback control readout is throttled to at most 10 Hz");
assert(
  pathCanvasPane.includes("playback={{") &&
    !pathCanvasPane.includes("playback={isPlaying ?") &&
    pathCanvasPane.includes("sample: playbackSample") &&
    pathEditor.includes("playbackClock.getTimelineMs() ||") &&
    pathEditor.includes("motionTimelineMsForPhase(phase, playbackDurationMs)") &&
    playbackHook.includes("!isPlaying ||") &&
    playbackHook.includes("return () => playbackClock.stop()") &&
    externalClock.includes("scheduler.cancelFrame(frameHandle)") &&
    pathCanvasPane.includes("mechanisms={[]}") &&
    pathCanvasPane.includes("const pathsToRender = React.useMemo(") &&
    pathCanvasPane.includes("paths={pathsToRender}"),
  "Path preserves held elapsed-time sampling while the shared clock gates idle animation and the scene excludes mechanism geometry",
);

console.log("b695 playback contract ok");
