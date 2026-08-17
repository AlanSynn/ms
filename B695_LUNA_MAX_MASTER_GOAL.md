# Luna Max Master `/goal`: b695 Visual-Lock Performance Backport

```text
/goal
Act as the Luna Max integration lead for MotionSmith's b695 visual-lock performance backport.

Read:
- B695_VISUAL_LOCK_PERFORMANCE_BACKPORT_PLAN.md
- B695_VISUAL_LOCK_COMMIT_LEDGER.tsv
- b695-luna-visual-lock-manifest.yaml

Immutable baseline:
b695b02275d03506969f2d13c98bc38107c17e0e

Read-only donor:
perf/unified-three-sol
Audited donor head:
983c421348e83c07b7d5a49f4517ec8efbaca6bc

Use Luna Max for every worker. Do not use any other model.

Mission:
Preserve every visible and interactive aspect of b695 while backporting only performance-critical, telemetry, and nonvisual I/O improvements.

Do not repair the donor branch in place. Create a clean worktree and branch from b695. Keep the donor branch read-only.

Absolute visual lock:
- no canvas, SVG, controller, CSS, layout, camera, material, light, texture, geometry, z-order, layer-default, animation-duration, timing-profile, interaction-output, or export-byte change;
- no side preview may become static;
- no new renderer, persistent orthographic shell, stage lens, prepared scene, or live-SVG removal;
- no mechanism/fabrication behavior change in the performance pack.

Before editing:
1. Resolve repository and worktree state.
2. Refuse to overwrite unknown changes.
3. Capture the full b695 golden screenshots at 1366x768 and 1440x900.
4. Record fixed-phase numeric outputs, camera matrices, material/geometry hashes, DOM/controller inventory, and export hashes.
5. Record a production performance proxy baseline.

Implement only these newly authored backport commits:
1. perf(ai): remove boot model warming
2. perf(persistence): coalesce and workerize autosave
3. perf(inspector): cache edit analysis by semantic revision
4. perf(diagnostics): remove E2E probes from production frames
5. perf(playback): move phase sampling off React without changing output
6. perf(frame): reuse projection and IK scratch state
7. perf(fit): stop after an accepted four-bar fit
8. perf(blueprint): cache exact preview and package models
9. study: emit one final semantic artifact

Donor use:
- 1716660 may be attempted with cherry-pick -n and an AI-only allowlist.
- 10a0a589 may be attempted with cherry-pick -n only after exact Fit parity.
- 5f5e2a8, 89c0abe, 87b7e30, 613d83e, 78964d5, de88b12, and 29c335e are design references, not blind cherry-picks.
- Never cherry-pick cdd7cae, e06357d, stage migration commits, visual recovery commits, abd9e9e, 8280ce6, a363e5d, or mechanism/fabrication authority commits.

Key implementation rules:
- Lazy AI creates no Worker or model request at boot.
- Autosave performs no synchronous serialization or storage write in pointer or playback paths.
- Inspector caches preserve the exact b695 DOM and visible-disabled option semantics.
- Production diagnostics execute no scene traversal, Box3 target collection, JSON serialization, or data-attribute writes.
- The playback refactor keeps the exact b695 renderer, DOM, formulas, camera, materials, and visible motion. React receives no frame-rate phase state.
- Projection and IK helpers reuse scratch state without changing fixed-phase output.
- The Fit early return is accepted only if every output and status is deeply equal to b695.
- Blueprint caching preserves the immediate visible document and exact export bytes.
- Study collection is one opt-in final semantic artifact only. It performs no playback work and default builds compile it out.

Validation:
Per commit run:
- bun run build
- one focused browser flow
- affected-stage visual golden comparison
- git diff --check

After diagnostics:
- production and E2E bundle scans
- full static visual lock

After playback/frame:
- exact fixed-phase numeric parity
- React commit count
- frame p50/p95/p99
- five-minute production proxy soak

Final:
- bun run test
- bun run build
- browser workflow
- complete visual golden set
- export byte hashes
- 4x and 6x CPU-throttled production proxy
- default/study bundle scans

Actual Chromebook hardware is unavailable. Report only proxy passed or proxy failed. Never claim Chromebook certification.

Reject any patch that improves performance by changing visible motion, hiding a control, reducing visual quality, changing a camera, modifying material/geometry, altering Fit output, or replacing the baseline canvas.

Finish only when all golden visual and numeric evidence is unchanged, performance gates improve, telemetry is final-artifact-only, and the integration worktree is clean.
```
