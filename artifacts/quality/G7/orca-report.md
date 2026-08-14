# G7 Orca report

## Orca-managed context

- CLI: public `orca` (`orca skills get orca-cli` loaded before Orca commands).
- Runtime status: ready, reachable, app version 1.4.181, runtime ID `5aa221c2-d1ac-4e04-b0a8-30e23faa79d1`.
- Worktree ID: `2a3d0911-edb9-44e2-b503-f6dcbd2dba95::/Users/alansynn/orca/workspaces/MechAnim/luna-qa-recovery`.
- Branch: `AlanSynn/luna-qa-recovery`.
- Orca terminals listed for this worktree: `G7-Run` (`term_7b7f180c-9e4e-4971-9fa1-79a7c34eb7c3`), `Setup` (`term_b5ac3739-0032-4f6d-8fd6-8481fdd6e641`), and `G7-Validation` (`term_ee64161e-c2d8-44b6-91ec-dd174e3dd25e`).

The supervised Orca launcher did not yield a runnable supervised Playwright process in this recovery. The exact launcher error was not retained in the inherited raw logs, so it is not reconstructed here. The public Orca CLI did manage the worktree and terminal context; the deciding Playwright/build commands used the local shell fallback in that managed checkout. No claim is made that the local Playwright command ran inside Orca's embedded browser.

## Embedded-browser evidence

The lead's independent Orca production-preview tab check used the managed embedded browser and recorded these call IDs:

1. `d0c80e6a`: before switch, Foundry renderable `ready`, dynamic build count `2`, signature `4bar.input-joint:linkage-2-cell:2|4bar.output-joint:linkage-2-cell:2`.
2. `226f6183`: blank tab foregrounded and app tab inactive.
3. `51a0bdba`: app tab restored.
4. `ad3de3bb`: after restore, visibility `visible` and the same renderable/signature/dynamic build-count values.

Orca's embedded pages also retain `document.visibilityState: "visible"` while inactive. The report therefore treats active-tab switch/restore and stable renderer state as the portable observable, without claiming hidden DOM visibility.

## Local fallback evidence

Deciding command:

```text
PLAYWRIGHT_SERVER=preview PLAYWRIGHT_PORT=43179 PLAYWRIGHT_WORKERS=2 bunx playwright test tests/browser/quality-critical.spec.ts
```

It passed with exit code 0. Exact output is preserved in `raw/critical-flow-final-production-preview.log`; page diagnostics and final serializable evidence are in `raw/diagnostics-e11c79d33e7a64046abf-ae8781d3e5f7636d0ef4.json` and `raw/critical-flow-evidence.json`.

The failed CDP lifecycle experiments are intentionally preserved as raw evidence, including the document-listener, renderer-clock, and host-callback failures. They are not represented as passing Orca or headless-browser lifecycle evidence.
