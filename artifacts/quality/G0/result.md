# G0 result

## Behavior verified

- Immutable baseline captured as `main` / `4f3f7cc4906c2fef49b5796c2c6e43988466b9d2` and tagged `quality-pass-start`.
- Root working-tree changes were recorded and excluded without mutation.
- All 82 historical commits resolve and have a primary lane.
- The mixed commits expand to 266 routed hunks; the complete hunk ledger has 346 rows, 82 unique commits, and zero unassigned rows.
- Seventy production path assignments have zero exact or ancestor/descendant overlap.
- Production web and Tauri frontend builds pass.
- Guided project, Character, Path, and Foundry startup flows render in Orca production preview.

## Baseline defects

- G1: the existing-mechanism sheet-fit fixture preserves selected-hole lengths but rejects `4bar.input-joint`; both the full unit command and focused test reproduce the failure.
- G3: clicking Foundry Play makes Orca snapshot/console/reload operations time out with `runtime_unavailable`; this needs Playwright isolation before assigning application causality.
- G3/UI: Foundry selected-item inspector contains explanatory paragraphs contrary to the result-first runtime-copy contract.
- G6: Tauri-relative frontend build warns that `./fonts/manrope-800-latin.woff2` is unresolved at build time.

## Assumptions rejected

- The historical range is not the current `95aaca21..main` graph: that range now has 16 clean-port commits. The 82 historical objects still resolve and are enumerated explicitly from the plan.
- The plan's summary routing for mixed commit `283e0be` is incomplete: inspected hunks also contain G1 edit-authority and G6 isolated-preview configuration behavior. The hunk ledger follows the patch evidence.

## Remaining risk

G0 characterizes but does not fix defects. G1 is the critical path. Only G4, G5, and G6 are dependency-ready after this commit; G2 waits for G1's domain freeze.
