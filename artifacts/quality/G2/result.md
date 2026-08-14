# G2 result

Result: G2 is complete for the owned quality boundary. Coordinate validity, assembly containment, individual cut-part fit, authoring readiness, and export eligibility are now separate contracts. Commit: `SELF` (`fix(fabrication): separate cut-part fit from assembly readiness`), amended in place with the required G2 evidence.

## Verified behavior

- Board coordinates use the geometric origin `(boardCells - 1) / 2` for both odd and even kits. Even-board bounds are physically centered; corners and closed physical boundaries round-trip to the nearest hole within an explicit half-cell diagonal tolerance. Exact containment receives only a `1e-9` geometric-boundary epsilon.
- Snap policy is unchanged and strict. A point halfway between holes is not declared a hole by the compiler. Fresh default mechanisms pass through the frozen G1 creation resolver, which may snap the candidate. Existing or imported explicit off-grid anchors remain unchanged, visible, and blocked.
- Board and sheet containment are evaluated separately for circles, capsules, and rotated boxes. A closed physical edge is contained; a point or corner beyond it is blocked.
- `cutPartDimensionsFitSheet` checks the dimensions of one cut blank, including the allowed axis swap after rotation. It does not claim whole-assembly sheet containment or multi-part nesting.
- A tiny-sheet project with a 41-cell board remains `blocked` for authoring and carries `Fit mechanism parts.` only. Every blocker is soft, validation with `allowSoftReadinessBlockers: true` has no hard errors, and package creation succeeds through that explicit soft-warning path.
- Blueprint and Assembly use the same `fabricationExportPolicy`. For warning-only readiness they remain navigable and expose `Make sheets`/`Build`; hard readiness errors remain blocked. The stages consume `project.lastExport` directly when that policy permits export.
- The stale-package invariant is aggregate-owned: `set_export` preserves the generated package identity through `touch()`, UI-only settings preserve it, physical-kit and scene edits clear it, and load clears serialized exports. No full scene is canonical-stringified during Blueprint/Assembly render, and `fabricationReadiness` has no `FabricationPackage`/`ProjectState` snapshot imports or snapshot-string helper.
- Foundry assembly board surfaces and board-coordinate markers use the same fitted physical affine as the mechanism preview, preserving cross-stage coordinate parity.
- The stale source copy `scripts/fabrication/source/board-final.svg` now has the reviewed 300 mm outline (`x=5`, `y=5`, `width=300`, `height=300`). Generator output, `fabrication/board-final.svg`, and the reviewed oracle all prove hash `9d0202b80395c555be87e0abb91ff10910d3c4ffdd580484e49c6368baa33568`.

## Evidence

Exact commands, stdout/stderr, exits, the routed dense-fixture failure, and the non-deciding browser failure are in [tests.txt](tests.txt). The focused G2 suite, neighboring fit/readiness/authority/renderer/consumer contracts, schema inventory, and production build all passed. `git diff --check` passed before the implementation commit.

The unchanged `bun tests/project-contract.test.ts` direct-compiler fixture still fails at line 1679 because it expects a dense 30x30, 10 mm kit to compile an explicit default even-board anchor. This is the agreed Sol amendment, not a G2 regression. The browser attempt fails before the app workbench appears because port 5173 serves `<title>Voice Studio</title>` from PID 25515; it is recorded as non-deciding, with no config or process mutation. Sol/G7 owns production-preview browser validation after G6 integration.

## Rejected assumptions

- A midpoint between even-board holes should be treated as snapped: rejected.
- Snap tolerance should be widened to satisfy the direct compiler fixture: rejected.
- A tiny sheet means the whole mechanism is off-board and must use `Fit inside board.`: rejected; it is an individual-part warning and uses `Fit mechanism parts.`.
- A soft authoring blocker must prevent Blueprint/Assembly navigation: rejected; `navigateAppStage` gates only hard readiness blockers, so both stages reach their target while export remains eligible.
- Full `ProjectState`/scene snapshot equality is a valid current-export check: rejected; aggregate identity/presence and action-level invalidation are authoritative.
- The stale board hash should simply be blessed: rejected; the reviewed source, generator output, generated artifact, and oracle were aligned and independently hashed.

## Owned files

The complete owned production boundary is: `utils/coordinates.ts`, `utils/fabricationBoardTemplate.tsx`, `utils/mechanismCollision.ts`, `utils/mechanismPhysicalEnvelope.ts`, `utils/mechanismReadiness.ts`, `utils/fabricationReadiness.ts`, `components/stages/blueprint/BlueprintExport.tsx`, `components/stages/assembly/AssemblyGuide.tsx`, `components/stages/foundry/foundryAssemblySceneOverlay.ts`, `fabrication/board-final.svg`, `scripts/fabrication/source/board-final.svg`, and `fabrication/fabrication-v2-reviewed-oracle.json`. The changed production subset and exact test paths are listed in [changed-files.txt](changed-files.txt): `tests/g2-coordinate-readiness.test.ts` and the user-authorized `tests/mechanism-build-gates.test.ts` correction. Evidence is limited to `artifacts/quality/G2/*`. The authoritative generated board and oracle, G1 files, shared config, package files, and Sol's dense fixture were not edited.

## Historical intent and disposition

The 14 requested historical G2 commits are covered below; none was replayed.

- `edd401c`: physical board boundary and scene-bounds intent retained; G2 adds explicit closed-boundary evidence.
- `bf93b36`: generated-mechanism board containment retained.
- `4506500`: base-hole parity retained.
- `6a66674`: Foundry assembly affine parity intent restored in the G2-owned overlay.
- `e2f608b`: centered even-board coordinate origin retained.
- `ef7a45d`: explicit board-anchor preservation retained in the frozen G1 authority; not edited.
- `565f0b4`: reviewed board-source alignment intent applied by repairing the stale source copy.
- `b8ad077`, `607a2e4`, `b65aa41`: authoring/candidate policy intent retained; no compatibility shim or compiler weakening added.
- `29e5432`: strict stage package policy reconciled with the current split; shared export policy is the only stage eligibility decision.
- `c11fdfd`: hard board assembly fit remains distinct from individual sheet fit.
- `e4a8fef`: Foundry readiness presentation intent retained.
- `c4605d2`: individual cut-part fit intent retained and made explicit as non-nesting.

No historical commit was cherry-picked, merged, rebased, or reset.

## Risks and intentional omissions

- Full production-preview browser validation is intentionally omitted from G2 because the pre-G6 Playwright setup reused an unrelated listener; Sol/G7 will rerun it after G6 integration.
- The shared dense direct-compiler assertion remains intentionally failing for Sol; changing it or changing compiler snap semantics would violate the current integration-owner decision.
- The fitted Foundry overlay receives focused renderer/consumer contract coverage but awaits the integrated production-preview flow.
- No central ledger, G1 authority file, shared configuration, package manifest, Playwright configuration, or unrelated user process was changed.
