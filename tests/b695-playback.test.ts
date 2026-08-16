import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPlaybackClock } from "../runtime/playback/externalPlaybackClock";

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

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");
const playbackHook = source("hooks/useWorkspacePlaybackLoop.ts");
const sceneSketch = source("components/stages/path/SceneSketch.tsx");
const puppetPreview = source("components/ThreePuppetPreview.tsx");
const foundryPreview = source("components/stages/foundry/ThreeFoundryPreview.tsx");
const foundryOverlay = source("components/stages/foundry/FoundryOverlayLayer.tsx");
const playerDock = source("components/shell/WorkspacePlayerDock.tsx");

assert(playbackHook.includes("playbackClock.start") && !playbackHook.includes("requestAnimationFrame("), "the workspace hook delegates scheduling to the external clock");
assert(!playbackHook.includes("setAngle("), "the workspace frame driver does not enqueue React phase state");
assert(sceneSketch.includes("playbackClock.subscribe") && sceneSketch.includes("setAttribute(\n          \"transform\""), "the 2D path preview updates its existing SVG nodes directly");
assert(puppetPreview.includes("playback.clock.subscribe") && puppetPreview.includes("partMeshesRef.current"), "the 3D puppet preview updates retained transforms from the external clock");
assert(foundryPreview.includes("playback.clock.subscribe") && foundryPreview.includes("renderDynamicRef"), "the shared Foundry renderer consumes sampled playback outside React");
assert(foundryOverlay.includes("playback.clock.subscribe") && foundryOverlay.includes("foundry-velocity-vector") && foundryOverlay.includes("setAttribute"), "the Foundry SVG physics overlay updates existing nodes directly from the external clock");
assert(playerDock.includes("time - lastControlUpdate < 100"), "the playback control readout is throttled to at most 10 Hz");

console.log("b695 playback contract ok");
