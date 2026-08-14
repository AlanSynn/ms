# A0 reconciled bottleneck ledger

Baseline: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`

Scope: audit evidence only; no production behavior changed in A0.

## Question and decision

The A0 question was which work must be removed from the live frame and stage-switch paths before a persistent fixed-view workbench can plausibly meet the Chromebook gates. The evidence supports three first-order seams:

1. Playback must stop driving React and domain derivation. Foundry, Design, and Assembly currently couple phase renders to safety, compiler, readiness, fabrication, candidate, and kinematics work.
2. One session runtime must own the canvas, renderer, context, cameras, resource pool, RAF, visibility lifecycle, and context recovery. Stage-owned renderer mounts are the measured source of context and shader churn.
3. Path must move directly to the orthographic Three plane only after its exact 900 x 680 `meet` mapping, canonical scene coordinates, pointer-up transaction semantics, and keyboard alternatives are frozen. The current SVG path is both a duplicate live renderer and the strongest existing input reference.

The complete ranked ledger is [bottleneck-ledger.tsv](bottleneck-ledger.tsv). Required initial counters are normalized in [../baseline/initial-counters.tsv](../baseline/initial-counters.tsv).

## Evidence hierarchy

- **Known from executed counters:** the CPU audit records exact function-entry, React commit, JSON byte, storage, and WebGL-clear counts in an instrumented production-mode build. These counts establish execution frequency. Headless timing and rAF timestamps do not establish presentation performance.
- **Known from wrapped WebGL calls:** the headed GPU audit records context identity, clear/draw/shader/program/texture calls, and context events. Its Path clear proxy is calibrated against `renderer.info`, but it is not a direct `renderer.render` or compositor frame counter. Foreground inspection failed and the host was not a Chromebook.
- **Known from source and focused contracts:** the interaction audit identifies canonical reducers, SVG CTM pointer mapping, accessibility locators, and fabrication/export authorities. Root reran all seven focused tests after dependencies were available.
- **Known only as visible UI observation:** the Orca audit exercised an active visible embedded page and captured stage surfaces. Its exact preview process could not be attributed because terminal sends produced no output and reload changed the visible version from `1.1.0` to `0.0.9`. Every Orca performance number is therefore rejected as a gate.

## Strongest evidence against overreach

- Warm paused Three surfaces submitted no GPU work in the sampled 700 ms windows. Dirty rendering is already a behavior to preserve, not a subsystem to replace.
- Foundry, Design, and Assembly were near one clear proxy per observed RAF in the headed GPU run. Path was the measured over-submission outlier; the universal problem is lifecycle ownership and frame-side domain work, not identical submission behavior in every stage.
- Detached non-lost contexts are strong lifecycle evidence but not a measurement of driver VRAM. Sampled allocation profiles show churn but are not exact allocation totals. Neither can approve a 4 GB device.
- Blueprint entry executed proof work once, but its steady cost was not isolated. The response is to defer exact artifact generation behind an explicit action while preserving the frozen bytes, not to weaken the exporter.

## Revised implementation order

1. Freeze the six requested runtime contracts and exact orthographic mapping.
2. Build immutable inspector and classroom-I/O boundaries, then the persistent renderer and prepared pose-cycle foundations in manifest integration order.
3. Cut the shell over to one canvas and one runtime before migrating stage adapters.
4. Migrate Character/Path, Foundry, Design, Assembly, and Blueprint against the frozen contracts; delete old live paths as each stage becomes complete.
5. Compile out diagnostics/study runtime by build profile, prove recovery, then tune the low-power GPU tier.
6. Run a source-attributable visible Orca production preview, repeated switch loop, 20-minute soak, and finally actual Intel and ARM 4 GB Chromebook acceptance.

## Verification performed by the integration owner

- Confirmed every A0 commit changed only its assigned `artifacts/performance/<audit>/**` path and passed `git show --check`.
- Recomputed the CPU headline counts and ratios from `raw/runtime-evidence.json`; reran TypeScript checking and validated every compressed trace/profile.
- Reran the GPU static audit into a temporary path, syntax-checked its scripts, recomputed submission/context/recovery values from raw JSON, reran the three focused GPU contracts, and visually inspected the restored and post-loop screenshots.
- Reran all seven interaction-focused tests on the integration worktree.
- Revalidated every Orca JSON artifact and the project contract test; independently observed the visible `v0.0.9` page before the audit session closed while the exact worktree `dist/index.html` remained `v1.1.0`.

## Approval boundary

A0 is complete as diagnosis. It approves the frozen-workbench implementation sequence, not the product. No frame percentile, input latency, LoAF, heap, thermal, warm-switch, or context-recovery approval gate has passed on either required Chromebook class.
