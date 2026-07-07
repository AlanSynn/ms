# Documentation Archive

Last refreshed: 2026-07-07

This directory stores **historical / superseded / provenance** documentation.

Use only when you need:

- past decision rationale,
- evidence for architectural drift,
- or archived implementation context.

Active planning and implementation should stay in:

- `docs/README.md` (global docs map)
- `docs/index.md` (hot/cold/index rails)
- `docs/prd/README.md` (active PRD map)
- `docs/analysis/README.md` (active analyses)

## Archive families

- [`archive/plans/README.md`](plans/README.md) — archived implementation plans
- [`archive/ui/README.md`](ui/README.md) — legacy UI docs/repro notes
- [`archive/ports/README.md`](ports/README.md) — external porting mirrors
- [`archive/analysis/README.md`](analysis/README.md) — historical audits/reports
- [`archive/execution/README.md`](execution/README.md) — governance/journal logs
- [`archive/misc/README.md`](misc/README.md) — single legacy notes

## Governance

1. Keep archive-only docs out of default implementation context.
2. If a doc becomes active again, promote it back to the hot set (and update all maps).
3. If a doc is obsolete and not needed, delete it and record that in session notes before cleanup.
4. Do not add new product docs directly to `archive/`.


## Deletion candidates

- None currently.
- Keep provenance bundles intact until an active task explicitly requires deletion, then remove after one release-cycle review and note rationale in session notes.
