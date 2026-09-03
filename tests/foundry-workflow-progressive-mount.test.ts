import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FoundryWorkflowPanel } from "../components/stages/foundry/FoundryWorkflowPanel";
import {
  FOUNDRY_INSPECTOR_IDLE_TIMEOUT_MS,
  FOUNDRY_INSPECTOR_SUPPORT_TIMEOUT_MS,
  FoundryInspectorPanel,
  scheduleFoundryInspectorControls,
} from "../components/stages/foundry/FoundryInspectorPanel";
import {
  ENABLED_FOUNDRY_MECHANISM_TYPES,
  MECHANISM_TEMPLATE_LIBRARY,
} from "../utils/mechanismTemplates";
import { createLessonProject } from "../utils/project";
import {
  feasibilityStatusForRange,
  sampleFeasibleRange,
} from "../utils/fabrication";

const project = createLessonProject("waving-arm");
const foundry = project.mechanisms[0];
assert(foundry, "the Foundry mount fixture includes a mechanism");

const initialMarkup = renderToStaticMarkup(
  createElement(FoundryWorkflowPanel, {
    project,
    goStage: () => {},
    foundry,
    foundryPhase: 0,
    targetReady: true,
    isPickingAnchor: false,
    hardBlocked: false,
    onToggleAnchorPick: () => {},
    onFitPath: () => {},
    onUseMechanism: () => {},
    onSelectMechanismType: () => {},
  }),
);

assert(initialMarkup.includes('data-testid="foundry-fit-path"'));
assert(initialMarkup.includes('data-testid="foundry-pick-anchor"'));
assert(initialMarkup.includes('aria-label="Use this mechanism"'));
assert(initialMarkup.includes('data-visible-previews="0"'));
assert.equal(
  initialMarkup.match(/recommendation-card mechanism-choice/g)?.length,
  ENABLED_FOUNDRY_MECHANISM_TYPES.length,
  "every template remains an immediately rendered button",
);
for (const type of ENABLED_FOUNDRY_MECHANISM_TYPES) {
  assert(initialMarkup.includes(MECHANISM_TEMPLATE_LIBRARY[type].label));
  assert(initialMarkup.includes(`foundry-mini-placeholder-${type}`));
}
assert(
  !initialMarkup.includes("foundry-mini-simulation-"),
  "the first Foundry commit does not build full linkage SVG previews",
);
assert(
  initialMarkup.length < 12_000,
  `the bounded initial workflow tree stays compact (${initialMarkup.length} bytes)`,
);

const source = readFileSync(
  join(
    process.cwd(),
    "components",
    "stages",
    "foundry",
    "FoundryWorkflowPanel.tsx",
  ),
  "utf8",
);
const progressiveGallery = source.slice(
  source.indexOf("const FoundryMechanismGallery"),
  source.indexOf("export const FoundryWorkflowPanel"),
);
const progressiveGalleryPreview = source.slice(
  source.indexOf("const FoundryGalleryPreview"),
  source.indexOf("const FoundryMechanismGallery"),
);
assert(progressiveGallery.includes("index < visiblePreviewCount"));
assert(progressiveGallery.includes("requestAnimationFrame"));
assert(progressiveGallery.includes("startTransition"));
assert(progressiveGallery.includes("Math.min(count + 1"));
assert(progressiveGallery.includes("cancelAnimationFrame(frame)"));
assert(progressiveGalleryPreview.includes("ghostsReady &&"));
assert(progressiveGalleryPreview.includes("window.setTimeout"));
assert(progressiveGalleryPreview.includes("timer !== undefined"));
assert(progressiveGalleryPreview.includes("window.clearTimeout(timer)"));

const library = MECHANISM_TEMPLATE_LIBRARY[foundry.type];
const initialInspectorMarkup = renderToStaticMarkup(
  createElement(FoundryInspectorPanel, {
    foundry,
    libraryLabel: library.label,
    classroomAssessmentKey: project.settings.classroomAssessmentKey,
    classroomSensemaking: library.classroomSensemaking,
    foundryRigOpacity: 85,
    foundryExplode: 0,
    feasibilityStatus: feasibilityStatusForRange(
      sampleFeasibleRange(foundry, 96),
    ),
    showSensemaking: false,
    onRigOpacityChange: () => {},
    onExplodeChange: () => {},
    onUpdateParams: () => {},
    onChangeParam: () => {},
    onSetMechanismType: () => {},
    onSetPreset: () => {},
    onToggleSensemaking: () => {},
  }),
);
assert(!initialInspectorMarkup.includes('data-testid="foundry-view-controls"'));
assert(!initialInspectorMarkup.includes('data-testid="foundry-feasibility-status"'));
assert(!initialInspectorMarkup.includes("Mechanism options"));
assert(
  !initialInspectorMarkup.includes('data-testid="foundry-parametric-editor"'),
  "the cold Foundry commit leaves the parametric editor for the next frame",
);
assert(
  !initialInspectorMarkup.includes('aria-label="Foundry mechanism type"'),
  "closed advanced controls do not add hidden DOM work to the cold commit",
);

const inspectorSource = readFileSync(
  join(
    process.cwd(),
    "components",
    "stages",
    "foundry",
    "FoundryInspectorPanel.tsx",
  ),
  "utf8",
);
assert.equal(FOUNDRY_INSPECTOR_IDLE_TIMEOUT_MS, 160);
assert.equal(FOUNDRY_INSPECTOR_SUPPORT_TIMEOUT_MS, 80);
let scheduledIdleCallback: IdleRequestCallback | undefined;
let scheduledIdleTimeout: number | undefined;
let cancelledIdleHandle: number | undefined;
let controlsMounted = false;
const cancelScheduledControls = scheduleFoundryInspectorControls(
  () => {
    controlsMounted = true;
  },
  {
    requestIdleCallback: (callback, options) => {
      scheduledIdleCallback = callback;
      scheduledIdleTimeout = options?.timeout;
      return 17;
    },
    cancelIdleCallback: (handle) => {
      cancelledIdleHandle = handle;
    },
    setTimeout: () => assert.fail("idle-capable browsers do not use a timer"),
    clearTimeout: () => assert.fail("idle-capable browsers do not clear a timer"),
  },
);
assert.equal(controlsMounted, false, "the initial commit stays control-light");
assert(scheduledIdleCallback, "the parametric editor receives its own idle task");
assert.equal(scheduledIdleTimeout, FOUNDRY_INSPECTOR_IDLE_TIMEOUT_MS);
scheduledIdleCallback({
  didTimeout: false,
  timeRemaining: () => 8,
});
assert.equal(controlsMounted, true, "the bounded idle task reveals the editor");
cancelScheduledControls();
assert.equal(
  cancelledIdleHandle,
  undefined,
  "completed idle work is not cancelled a second time",
);

let staleControlsMounted = false;
const cancelStaleControls = scheduleFoundryInspectorControls(
  () => {
    staleControlsMounted = true;
  },
  {
    requestIdleCallback: (callback) => {
      scheduledIdleCallback = callback;
      return 23;
    },
    cancelIdleCallback: (handle) => {
      cancelledIdleHandle = handle;
    },
    setTimeout: () => assert.fail("idle-capable browsers do not use a timer"),
    clearTimeout: () => assert.fail("idle-capable browsers do not clear a timer"),
  },
);
cancelStaleControls();
scheduledIdleCallback({
  didTimeout: false,
  timeRemaining: () => 8,
});
assert.equal(staleControlsMounted, false, "unmount cancels stale inspector work");
assert.equal(cancelledIdleHandle, 23);
let supportControlsMounted = false;
const cancelSupportControls = scheduleFoundryInspectorControls(
  () => {
    supportControlsMounted = true;
  },
  {
    requestIdleCallback: (callback, options) => {
      scheduledIdleCallback = callback;
      scheduledIdleTimeout = options?.timeout;
      return 29;
    },
    cancelIdleCallback: () => {},
    setTimeout: () => assert.fail("idle-capable browsers do not use a timer"),
    clearTimeout: () => assert.fail("idle-capable browsers do not clear a timer"),
  },
  FOUNDRY_INSPECTOR_SUPPORT_TIMEOUT_MS,
);
assert.equal(supportControlsMounted, false);
assert.equal(scheduledIdleTimeout, FOUNDRY_INSPECTOR_SUPPORT_TIMEOUT_MS);
scheduledIdleCallback({ didTimeout: false, timeRemaining: () => 8 });
assert.equal(supportControlsMounted, true);
cancelSupportControls();
assert(inspectorSource.includes("requestIdleCallback"));
assert(inspectorSource.includes("cancelIdleCallback"));
assert(inspectorSource.includes("startTransition"));
assert(inspectorSource.includes("event.currentTarget.open"));
assert(inspectorSource.includes("advancedControlsMounted &&"));

console.log("Foundry workflow progressive-mount tests passed.");
