import assert from "node:assert/strict";

import {
  createFrameCommitSession,
  type FrameCommitScheduler,
} from "../utils/frameCommitQueue";

const callbacks = new Map<number, () => void>();
const cancelled: number[] = [];
let nextHandle = 1;
const scheduler: FrameCommitScheduler = {
  request: (callback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  },
  cancel: (handle) => {
    cancelled.push(handle);
    callbacks.delete(handle);
  },
};
const commits: number[] = [];
const session = createFrameCommitSession<number>({
  scheduler,
  commit: (value) => commits.push(value),
});

assert.equal(session.move(0), false, "camera samples outside a gesture are ignored");
session.start();
session.move(1);
session.move(2);
session.move(3);
assert.equal(callbacks.size, 1, "a camera pointer burst schedules one display frame");
assert.deepEqual(commits, [], "camera samples do not commit per pointer event");
const firstHandle = callbacks.keys().next().value as number;
const firstCallback = callbacks.get(firstHandle);
callbacks.delete(firstHandle);
firstCallback?.();
assert.deepEqual(commits, [3], "the display frame commits only the latest camera sample");

session.move(4);
const terminalHandle = callbacks.keys().next().value as number;
assert.equal(session.finish(), true, "pointer end finishes an active camera gesture");
assert.deepEqual(commits, [3, 4], "pointer end flushes the final camera sample");
assert(cancelled.includes(terminalHandle), "terminal flush cancels its queued display callback");
assert.equal(session.finish(), false, "duplicate terminal routes do not commit twice");

session.start();
session.move(5);
const staleCallback = callbacks.values().next().value as (() => void) | undefined;
session.reset();
staleCallback?.();
assert.deepEqual(commits, [3, 4], "cleanup or replacement discards stale camera work");

const sources = await Promise.all(
  [
    "components/stages/foundry/MechanismFoundry.tsx",
    "components/stages/mechanism/DesignFoundryPreview.tsx",
    "components/stages/assembly/AssemblyThreePreview.tsx",
    "components/ThreePuppetPreview.tsx",
  ].map(async (file) => [file, await Bun.file(file).text()] as const),
);
for (const [file, source] of sources) {
  assert(
    source.includes("useFrameCommitSession"),
    `${file} uses the shared mounted display-frame gesture session`,
  );
  assert(
    source.includes("FrameSession.finish()"),
    `${file} flushes the queued camera sample on pointer end`,
  );
}

const hookSource = await Bun.file("hooks/useFrameCommitSession.ts").text();
assert(
  hookSource.includes("createFrameCommitSession") &&
    hookSource.includes("useEffect(() => () => session.reset()"),
  "the React adapter owns fresh callbacks and unmount cancellation in one place",
);
for (const file of [
  "components/stages/foundry/MechanismFoundry.tsx",
  "components/stages/mechanism/DesignFoundryPreview.tsx",
  "components/ThreePuppetPreview.tsx",
]) {
  const source = sources.find(([candidate]) => candidate === file)?.[1] ?? "";
  assert(
    source.includes("FrameSession.reset()"),
    `${file} cancels queued camera work before a preset replacement`,
  );
}

const foundryPreviewSource = await Bun.file(
  "components/stages/foundry/ThreeFoundryPreview.tsx",
).text();
assert(
  foundryPreviewSource.includes("onLostPointerCapture={onPointerCancel}"),
  "Foundry, Design, and Assembly camera surfaces finalize lost capture",
);

const puppetSource = sources.find(
  ([file]) => file === "components/ThreePuppetPreview.tsx",
)?.[1] ?? "";
assert(
  puppetSource.includes("onLostPointerCapture={finishViewerDrag}"),
  "the shared puppet camera finalizes lost capture",
);
assert(
  puppetSource.includes("if (start.mode === 'select')") &&
    puppetSource.includes("onSelectOnlyPointerMove?.(event)"),
  "select-only manipulation remains on its immediate pointer event path",
);
assert(
  puppetSource.includes("if (start.mode !== 'select') viewerCameraFrameSession.finish()"),
  "only puppet orbit and pan samples enter the camera frame session",
);

console.log("G3 camera cadence contracts passed");
