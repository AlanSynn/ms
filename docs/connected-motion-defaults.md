# Connected motion defaults

The physical part pivot and a motion chain's fixed start are different values.
A hand plate pivots at the wrist; its automatic motion starts at the shoulder
and solves shoulder → elbow → hand. Three joints form two rigid segments, not
three degrees of independent rotation.

## Starter behavior

| Selected part | Automatic start → handle | Segments |
| --- | --- | --- |
| Upper arm, lower arm, hand | Shoulder → elbow → hand | 2 |
| Upper leg, lower leg, foot | Hip → knee → foot | 2 |
| Head | Neck → head top | 1 |
| Torso | Center hip → torso | 1 |

Both sides use the same rule. Starter fold signs come from the authored rest
geometry, so beginning at the resting hand or foot does not flip a joint. Existing
imported and manually chosen fold signs remain unchanged. The torso never chooses an arbitrary arm as its
default handle. Character shows **New path defaults**. Path shows its actual
**Start → Handle**. **Change joints** contains manual overrides; **Automatic**
restores the current rig's defaults without changing the path or physical pivots.

## Rules for other rigs

`utils/motionChains.ts` derives defaults from the skeleton topology, without
anatomical joint names, a fixed depth, or a separate template registry:

1. Follow the selected part's single-child branch to its end. Stop at a fork
   instead of selecting a child by insertion order.
2. Find the start of that limb after the nearest ancestor fork. A single-joint
   branch includes its parent attachment so it can rotate without detaching.
3. A locked joint on the chosen chain becomes the fixed start. A locked moving
   descendant blocks motion. Unrelated branches at the fixed start stay still.
4. Valid explicit handles and starts remain authoritative. Missing legacy values
   resolve through the same rules. New paths persist the resolved pair; character
   replacement preserves manual starts and recomputes missing defaults.

An explicit start equal to the handle retains free subtree translation. If that
joint has a parent, Path displays **Use Automatic to keep joints connected**.
This manual mode is preserved for existing projects; it is not the default for
attached hands or feet. A free-standing skeleton root can translate as a whole.

## Shared pose application

Cached Path sampling and mechanism output both use the same pose application in
`utils/motion.ts`. `utils/motionSolver.ts` keeps the start fixed and segment lengths
constant. Reachable two-segment chains honor the middle joint's fold direction.
Longer chains use the authored shape with iterative solving and a geometric
fallback for degenerate poses. They do not advertise a fold toggle that the solver
does not implement.

`utils/motionPose.ts` rotates attached off-chain branches with their incoming
segment. Leaf pieces inherit the incoming segment's angle while retaining their
authored rotation offset and scale. Part transforms are derived from the canonical
rest pose after joint updates, including legacy parts without saved local pivots.
Independent limbs therefore cannot reset each other's transforms.

Unreachable targets are clamped to the chain's reachable range. The legacy
`pinTarget` option cannot stretch a rigid segment. Path and mechanism previews
show a reach correction when the remaining gap exceeds 0.5 scene units. This
tolerance controls the visible warning, not the preserved segment length.

## Verification

- `tests/motion-chains.test.ts`: all 14 starter and lesson parts, renamed and
  reordered rigs, branches, locks, explicit overrides, file round trips,
  character replacement, and independent path/binding order.
  The three available classroom lessons are sampled at 96 phases through both
  their authored paths and physical mechanisms, checking reach and every bone length.
- `tests/motion-pose.test.ts`: leaf orientation, rigid branches, authored transforms,
  missing pivots, and canonical pose composition.
- `tests/motion-solver.test.ts`: 4,851 deterministic reach cases, including zero
  links, straight/folded chains, and chains with up to 48 joints.
- `tests/automata-scene-runtime.test.ts`: protected pre-change mechanism, physics,
  path and fabrication projection hashes plus explicit pose/attachment invariants.
- `tests/browser/connected-motion.spec.ts`: new paths through ordinary controls,
  rendered mesh attachment/rotation during playback, and manual starts through
  Save/Open and Automatic reset.

The pure helper extractions were checked against fixed ProjectState fixtures,
motion previews, scene projections, fabrication plans, and PDF bytes before
behavior changed. The later pose golden changes were independently compared with
the original motion implementation. Detailed local evidence is under
`artifacts/anchor-fix/`; those generated artifacts are not bundled with the app.

The legacy cam-based head-bob lesson remains excluded from the student starter
list by the existing mechanism availability rule. Its straight lifting output
cannot follow the fixed-length neck-to-head arc. Imported legacy content now
reports that reach mismatch instead of stretching the head; this change does
not re-enable or certify the cam lesson.

## Verified run — 2026-09-07

- `bun run test:all` passed all 54 unit/contract files, including the six pre-commit
  regression suites. `bun run test` also passed after adding the available-lesson
  reach gate: 40 connected-chain cases and 4,851 fixed-length solver cases.
- Production-preview browser verification passed 26 distinct cases across
  connected motion, two-path authoring, painted motion, standalone artwork,
  Project/Design playback, control discovery, mechanism ownership and feedback.
  Repair reruns are recorded per case in the ignored
  `artifacts/anchor-fix/browser-verification-summary.json`.
- The paused Project check now waits for the committed held phase before comparing
  the final submitted mesh pose. Its coordinate tolerance remains unchanged.
  The two-driver export fixture uses separate arms; the overlap rejection tests remain.
- E2E and Tauri frontend production builds passed TypeScript, the image-recognition
  exclusion guard and the browser/Worker boundary guard.
- The final normal GitHub Pages build uses `/ms/`. Its compressed core JavaScript
  is 199,928 bytes against the unchanged 200,000-byte limit; the initial shell is
  261,947 bytes against 300,000. Every optional chunk also passes its limit.
  All four control-discovery browser cases passed on this exact non-diagnostic
  build at 1024 and 1366 pixels. Preview and browser both used `/ms/`
  (`VITE_BASE_PATH` and `PLAYWRIGHT_BASE_PATH`); an earlier run with a root-based
  preview server served HTML for the entry JavaScript and was stopped and corrected.
- The existing Search panel and feedback transport load on use to retain the
  unchanged browser bundle limits. Feedback browser checks used a local test
  endpoint intercepted by Playwright; no feedback was sent externally.

The original user's browser project was preserved. The isolated Orca check
inspected all 14 part defaults and created a shoulder-to-hand path through the
ordinary controls, then closed its QA tab. No release tag or deployment was made.
