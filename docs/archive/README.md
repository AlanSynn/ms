# Documentation Archive

Last refreshed: 2026-07-07

Stores **historical / superseded / provenance** docs.

Use only when need:

- past decision rationale
- architectural drift evidence
- archived impl context

Active planning/impl stay in:

- `docs/README.md` (global docs map)
- `docs/index.md` (hot/cold/index rails)
- `docs/prd/README.md` (active PRD map)
- `docs/analysis/README.md` (active analyses)

## Archive families

- [`archive/plans/README.md`](plans/README.md) — archived impl plans
- [`archive/ui/README.md`](ui/README.md) — legacy UI docs/repro notes
- [`archive/ports/README.md`](ports/README.md) — external porting mirrors
- [`archive/analysis/README.md`](analysis/README.md) — historical audits/reports
- [`archive/execution/README.md`](execution/README.md) — governance/journal logs
- [`archive/misc/README.md`](misc/README.md) — single legacy notes

## Governance

1. Keep archive-only docs out of default impl context.
2. If doc active again, promote back to hot set (update all maps).
3. If obsolete/unused, delete + record in session notes before cleanup.
4. Don't add new product docs directly to `archive/`.

## Deletion candidates

- None currently.
- Keep provenance bundles intact until active task needs deletion. Remove after one release-cycle review, note rationale in session notes.