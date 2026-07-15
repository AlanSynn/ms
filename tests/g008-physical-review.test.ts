import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import type { ConnectionSelection, MechanismConfig, PhysicalKitSettings } from "../types";
import { MechanismParametricEditor } from "../components/stages/mechanism/MechanismParametricEditor";
import {
  projectMechanismConnectionHoleHandles,
  resolveMechanismConnectionDrop,
} from "../components/stages/mechanism/MechanismConnectionOverlay";
import {
  boardToScene,
  defaultPhysicalKit,
  isBoardCoordinateInKit,
  parseBoardCoordinateLabel,
} from "../utils/coordinates";
import {
  FABRICATION_BOARD_MOUNT_SPECS,
  fabricationReferenceBoardMountHoleIds,
} from "../utils/fabricationContract";
import {
  FOUNDRY_OVERLAY_SIZE,
  FOUNDRY_VIEW_PRESETS,
} from "../utils/foundryCamera";
import {
  foundryPlaybackPhaseToInputAngle,
  primaryFoundryPlaybackPath,
  resolveFoundryPlaybackTraceAuthority,
} from "../utils/foundryPlayback";
import { calculateLinkage } from "../utils/kinematics";
import { mechanismWithGeneratedPath } from "../utils/mechanismGeneratedPath";
import {
  authorMechanismConnectionSelection,
  mechanismConnectionHoleCandidates,
  normalizeMechanismConnectionSelections,
  physicalConnectionForRole,
  resolveMechanismPhysicalConnections,
} from "../utils/mechanismConnectionSelections";
import {
  mechanismPhysicalConnectionCandidates,
  resolveMechanismPhysicalFamilySelectionAttempt,
  resolveMechanismPhysicalSelectionAttempt,
} from "../utils/mechanismPhysicalCandidates";
import { createDefaultMechanism } from "../utils/mechanismDefaults";
import { mechanismEditIsSafe } from "../utils/mechanismEditAuthority";
import { compileMechanismGraphFabrication } from "../utils/mechanismCompiler";
import { mechanismGraphForMechanism } from "../utils/mechanismGraph";
import { normalizeMechanismToReference } from "../utils/mechanismReference";

const withSelections = (
  mechanism: MechanismConfig,
  selections: Partial<NonNullable<MechanismConfig["connectionSelections"]>>,
  kit: PhysicalKitSettings,
): MechanismConfig => ({
  ...mechanism,
  ...normalizeMechanismConnectionSelections(
    mechanism,
    selections,
    undefined,
    { kit },
  ),
});

const customKit: PhysicalKitSettings = {
  ...defaultPhysicalKit(),
  profileKey: "g008-custom-12x12",
  boardCells: 12,
  gridPitchMm: 17,
};

const camAnchor = boardToScene(5, 7, customKit);
const customCam = withSelections(
  {
    ...normalizeMechanismToReference(createDefaultMechanism("cam", "g008-custom-cam")),
    anchorX: camAnchor.x,
    anchorY: camAnchor.y,
  },
  {
    "cam.guide-mount": {
      kind: "board-mount-pattern",
      mountKey: "cam-guide-2-hole",
      boardHoleIds: ["K10", "K8"],
    },
    "cam.follower-output-hole": {
      kind: "module-hole",
      moduleKey: "gravity-follower-module-v2",
      holeId: "output-0",
    },
  },
  customKit,
);

const pistonAnchor = boardToScene(3, 5, customKit);
const customPiston = withSelections(
  {
    ...normalizeMechanismToReference(createDefaultMechanism("piston", "g008-custom-piston")),
    anchorX: pistonAnchor.x,
    anchorY: pistonAnchor.y,
  },
  {
    "piston.crank-pin": {
      kind: "linkage-hole",
      linkageKey: "linkage-2-cell",
      holeIndex: 2,
    },
    "piston.rod-slider-pin": {
      kind: "linkage-hole",
      linkageKey: "linkage-6-cell",
      holeIndex: 3,
    },
    "piston.guide-mount": {
      kind: "board-mount-pattern",
      mountKey: "piston-guide-3-hole",
      boardHoleIds: ["F8", "F9", "F10"],
    },
  },
  customKit,
);

for (const [mechanism, role, nodeId] of [
  [customCam, "cam.guide-mount", "follower-guide"],
  [customPiston, "piston.guide-mount", "guide"],
] as const) {
  const resolved = resolveMechanismPhysicalConnections(mechanism, customKit);
  const mount = physicalConnectionForRole(resolved, role)?.boardMount;
  assert(mount, `${mechanism.type} resolves its guide with the active custom kit`);
  const expectedFirst = parseBoardCoordinateLabel(mount.selection.boardHoleIds[0]);
  const expectedLast = parseBoardCoordinateLabel(mount.selection.boardHoleIds.at(-1));
  assert(expectedFirst && expectedLast);
  const first = boardToScene(expectedFirst.col, expectedFirst.row, customKit);
  const last = boardToScene(expectedLast.col, expectedLast.row, customKit);
  assert.deepEqual(mount.origin, first);
  assert.deepEqual(mount.center, {
    x: (first.x + last.x) / 2,
    y: (first.y + last.y) / 2,
  });

  const state = calculateLinkage(mechanism, 0.37, customKit);
  assert(state.isValid, `${mechanism.type} samples with the active custom kit`);
  const graph = mechanismGraphForMechanism(mechanism, customKit);
  assert.deepEqual(
    graph.nodes.find((node) => node.id === nodeId)?.position,
    mount.origin,
    `${mechanism.type} graph uses the same custom-kit mount coordinate`,
  );
  const compiled = compileMechanismGraphFabrication(mechanism, customKit);
  const compiledMount = compiled.renderPlan.connectionSelectionSummary
    ?.physicalConnections.find((connection) => connection.role === role)
    ?.boardMount;
  assert.deepEqual(
    compiledMount?.center,
    mount.center,
    `${mechanism.type} compiler keeps the custom-kit physical coordinate`,
  );
  assert(
    mount.selection.boardHoleIds.every((hole) => isBoardCoordinateInKit(hole, customKit)),
    `${mechanism.type} mount stays inside the 12-cell board`,
  );
}

const defaultKit = defaultPhysicalKit();
const defaultCam = withSelections(
  normalizeMechanismToReference(createDefaultMechanism("cam", "g008-cam")),
  {},
  defaultKit,
);
const defaultPiston = withSelections(
  normalizeMechanismToReference(createDefaultMechanism("piston", "g008-piston")),
  {},
  defaultKit,
);

for (const [mechanism, role, expected] of [
  [defaultCam, "cam.guide-mount", ["J11", "J9"]],
  [defaultPiston, "piston.guide-mount", ["G11", "G12", "G13"]],
] as const) {
  const state = calculateLinkage(mechanism, 0, defaultKit);
  const candidates = mechanismPhysicalConnectionCandidates(
    mechanism,
    state,
    defaultKit,
  ).filter((candidate) => candidate.role === role);
  assert(candidates.length > 1, `${role} exposes multiple safe ordered tuples`);
  assert.equal(
    new Set(candidates.map((candidate) => candidate.identity)).size,
    candidates.length,
    `${role} candidates use full unique physical identity`,
  );
  assert(
    candidates.some((candidate) =>
      candidate.selection.kind === "board-mount-pattern" &&
      candidate.selection.boardHoleIds.join(",") === expected.join(",")
    ),
    `${role} retains its approved exact default tuple`,
  );
  assert(
    candidates.every((candidate) =>
      candidate.selection.kind !== "board-mount-pattern" ||
      candidate.selection.boardHoleIds.every((hole) => isBoardCoordinateInKit(hole, defaultKit))
    ),
    `${role} advertises only valid board cells`,
  );
}

for (const mechanism of [
  withSelections(normalizeMechanismToReference(createDefaultMechanism("4bar", "g008-safe-fourbar")), {}, defaultKit),
  defaultPiston,
]) {
  const state = calculateLinkage(mechanism, 0, defaultKit);
  const rawCandidates = mechanismConnectionHoleCandidates(
    mechanism,
    state,
    mechanism.connectionSelections,
    defaultKit,
  );
  const safeCandidates = mechanismPhysicalConnectionCandidates(
    mechanism,
    state,
    defaultKit,
  );
  const unsafe = rawCandidates.filter((candidate) => {
    const updates = authorMechanismConnectionSelection(
      mechanism,
      candidate.role,
      candidate.selection,
      defaultKit,
    );
    return !updates.rejection && !mechanismEditIsSafe({ ...mechanism, ...updates }, defaultKit);
  });
  assert(unsafe.length > 0, `${mechanism.type} fixture covers a known unsafe physical choice`);
  assert(
    unsafe.every((candidate) =>
      !safeCandidates.some((safe) => safe.identity === candidate.identity)
    ),
    `${mechanism.type} shared candidates do not advertise unsafe closure/clearance choices`,
  );
}

const camOutput2: ConnectionSelection = {
  kind: "module-hole",
  moduleKey: "gravity-follower-module-v2",
  holeId: "output-2",
};
const camOutputAttempt = resolveMechanismPhysicalSelectionAttempt(
  defaultCam,
  "cam.follower-output-hole",
  camOutput2,
  defaultKit,
);
assert.equal(camOutputAttempt.status, "accepted");
assert.notDeepEqual(
  primaryFoundryPlaybackPath(defaultCam, 48, defaultKit),
  primaryFoundryPlaybackPath(
    { ...defaultCam, ...(camOutputAttempt.status === "accepted" ? camOutputAttempt.updates : {}) },
    48,
    defaultKit,
  ),
  "cam follower-output selection changes the primary generated motion path",
);

const planetary = withSelections(
  normalizeMechanismToReference(createDefaultMechanism("planetary_gear", "g008-planetary")),
  {},
  defaultKit,
);
const planetaryOutputAttempt = resolveMechanismPhysicalSelectionAttempt(
  planetary,
  "planetary_gear.carrier-output-hole",
  { kind: "linkage-hole", linkageKey: "linkage-4-cell", holeIndex: 4 },
  defaultKit,
);
assert.equal(planetaryOutputAttempt.status, "accepted");
const selectedPlanetary = {
  ...planetary,
  ...(planetaryOutputAttempt.status === "accepted" ? planetaryOutputAttempt.updates : {}),
};
assert.notDeepEqual(
  primaryFoundryPlaybackPath(planetary, 48, defaultKit),
  primaryFoundryPlaybackPath(selectedPlanetary, 48, defaultKit),
  "planetary carrier-output selection changes the primary generated motion path",
);
const selectedPlanetaryTrace = primaryFoundryPlaybackPath(selectedPlanetary, 96, defaultKit);
const selectedPlanetaryHalfState = calculateLinkage(
  selectedPlanetary,
  foundryPlaybackPhaseToInputAngle(selectedPlanetary, Math.PI),
  defaultKit,
);
assert.deepEqual(
  selectedPlanetaryTrace[48],
  selectedPlanetaryHalfState.effector,
  "selected planetary output hole is the playback-mapped Foundry effector trace",
);
assert.deepEqual(
  mechanismWithGeneratedPath(selectedPlanetary, { kit: defaultKit }).generatedPath,
  selectedPlanetaryTrace,
  "selected planetary output hole drives the stored character motion path",
);

const unsafeFourBar = withSelections(
  normalizeMechanismToReference(createDefaultMechanism("4bar", "g008-rejection")),
  {},
  defaultKit,
);
const unsafeState = calculateLinkage(unsafeFourBar, 0, defaultKit);
const unsafeCandidate = mechanismConnectionHoleCandidates(
  unsafeFourBar,
  unsafeState,
  unsafeFourBar.connectionSelections,
  defaultKit,
).find((candidate) => candidate.identity === "4bar.output-joint:linkage-2-cell:1");
assert(unsafeCandidate, "known unsafe four-bar output candidate remains available only to the raw audit helper");
const unsafeHandle = projectMechanismConnectionHoleHandles({
  mechanism: unsafeFourBar,
  state: unsafeState,
  kit: defaultKit,
  camera: { ...FOUNDRY_VIEW_PRESETS.iso, preset: "iso", pan: { x: 0, y: 0 } },
  projectionSize: FOUNDRY_OVERLAY_SIZE,
  candidates: [unsafeCandidate],
})[0];
assert(unsafeHandle);
assert.deepEqual(
  resolveMechanismConnectionDrop(unsafeFourBar, unsafeHandle, defaultKit),
  { status: "rejected", blocker: "Fix: Choose anchor" },
  "unsafe physical commit rejects with the exact recovery blocker",
);

const camMountSpec = FABRICATION_BOARD_MOUNT_SPECS.find(
  (spec) => spec.key === "cam-guide-2-hole",
);
assert(camMountSpec);
assert.equal(camMountSpec.gridPitchCount, 2);
assert.deepEqual(camMountSpec.orderedDeltasMm, [{ x: 0, y: 40 }]);
assert.deepEqual(fabricationReferenceBoardMountHoleIds("cam-guide-2-hole"), ["J11", "J9"]);
const assemblySource = await Bun.file("scripts/fabrication/source/assembly/recipes.json").json();
const camRecipe = assemblySource.recipes.find(
  (recipe: { app_mapping?: { mechanism_type?: string } }) =>
    recipe.app_mapping?.mechanism_type === "cam_follower",
);
assert(camRecipe);
assert(!JSON.stringify(camRecipe).includes("J8"), "cam guide source metadata contains no J11/J8 drift");

const fourBarEditor = renderToString(createElement(MechanismParametricEditor, {
  mechanism: unsafeFourBar,
  kit: defaultKit,
  onChange: () => undefined,
}));
for (const label of ["Input link length", "Output link length"]) {
  assert.match(
    fourBarEditor,
    new RegExp(`aria-label="${label}"[^>]*disabled=""`),
    `${label} is confirmation-only because a physical role owns the endpoint`,
  );
}

const familyFourBar = withSelections(
  normalizeMechanismToReference(createDefaultMechanism("4bar", "g018-family-fourbar")),
  {},
  defaultKit,
);
const familyFourBarState = calculateLinkage(familyFourBar, 0, defaultKit);
const familyFourBarCandidates = mechanismPhysicalConnectionCandidates(
  familyFourBar,
  familyFourBarState,
  defaultKit,
).filter((candidate) => candidate.role === "4bar.input-joint");
const alternateLinkageCandidate = familyFourBarCandidates.find((candidate) =>
  candidate.selection.kind === "linkage-hole" &&
  candidate.selection.linkageKey !== familyFourBar.connectionSelections?.["4bar.input-joint"]?.linkageKey
);
assert(alternateLinkageCandidate, "four-bar overlay exposes a safe prospective linkage family");
const alternateLinkageAttempt = resolveMechanismPhysicalSelectionAttempt(
  familyFourBar,
  alternateLinkageCandidate.role,
  alternateLinkageCandidate.selection,
  defaultKit,
);
assert.equal(alternateLinkageAttempt.status, "accepted");
const switchedLinkage = {
  ...familyFourBar,
  ...(alternateLinkageAttempt.status === "accepted" ? alternateLinkageAttempt.updates : {}),
};
assert.equal(
  switchedLinkage.connectionSelections?.["4bar.input-joint"]?.kind === "linkage-hole"
    ? switchedLinkage.connectionSelections["4bar.input-joint"].linkageKey
    : undefined,
  alternateLinkageCandidate.partKey,
  "linkage family and physical hole commit together",
);
assert.equal(
  switchedLinkage.crankLength,
  physicalConnectionForRole(
    resolveMechanismPhysicalConnections(switchedLinkage, defaultKit),
    "4bar.input-joint",
  )?.local?.length,
  "the selected physical hole remains the linkage length authority",
);

const familyGearLinkage = withSelections(
  normalizeMechanismToReference(createDefaultMechanism("gear_linkage", "g018-family-gear")),
  {},
  defaultKit,
);
const familyGearState = calculateLinkage(familyGearLinkage, 0, defaultKit);
const prospectiveGearFamilies = new Set(
  mechanismPhysicalConnectionCandidates(
    familyGearLinkage,
    familyGearState,
    defaultKit,
  )
    .filter((candidate) => candidate.role === "gear_linkage.drive-pin")
    .map((candidate) => candidate.partKey),
);
assert(prospectiveGearFamilies.has("g24"));
assert(prospectiveGearFamilies.has("g40"), "gear overlay exposes a safe prospective G5 family");
const gearFamilyAttempt = resolveMechanismPhysicalFamilySelectionAttempt(
  familyGearLinkage,
  "gear_linkage.drive-pin",
  "g40",
  defaultKit,
);
assert.equal(gearFamilyAttempt.status, "accepted");
const switchedGear = {
  ...familyGearLinkage,
  ...(gearFamilyAttempt.status === "accepted" ? gearFamilyAttempt.updates : {}),
};
const switchedDriveSelection = switchedGear.connectionSelections?.["gear_linkage.drive-pin"];
assert(switchedDriveSelection?.kind === "gear-attachment-hole");
assert.equal(switchedDriveSelection.gearKey, "g40");
assert.equal(switchedGear.gearTrainRadii?.[0], 100);
assert.equal(
  compileMechanismGraphFabrication(switchedGear, defaultKit)
    .renderPlan.connectionSelectionSummary?.physicalConnections
    .find((connection) => connection.role === "gear_linkage.drive-pin")?.partKey,
  "gears:g40",
  "the committed family and selected physical hole reach the shared compiler together",
);

for (const [mechanism, secondaryId] of [
  [defaultCam, "B"],
  [planetary, "D"],
  [familyFourBar, "B"],
] as const) {
  const authority = resolveFoundryPlaybackTraceAuthority(
    mechanism,
    96,
    defaultKit,
    secondaryId,
  );
  assert.equal(authority.primary?.id, "C", `${mechanism.type} keeps structural output C primary`);
  assert.equal(authority.display?.id, secondaryId, `${mechanism.type} may inspect a secondary trace`);
  assert.deepEqual(
    authority.traces.filter((trace) => trace.primary).map((trace) => trace.id),
    ["C"],
    `${mechanism.type} inspection never promotes a secondary trace`,
  );
  assert(authority.primary && authority.display);
  assert.notDeepEqual(authority.primary.points, authority.display.points);
  const canonicalPersisted = mechanismWithGeneratedPath(
    { ...mechanism, generatedPath: authority.display.points },
    { kit: defaultKit },
  );
  assert.deepEqual(
    canonicalPersisted.generatedPath,
    authority.primary.points,
    `${mechanism.type} persisted generated path ignores the display-only trace`,
  );
}

console.log("G008 physical review contracts passed");
