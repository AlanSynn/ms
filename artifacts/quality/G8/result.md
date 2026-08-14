# G8 result

Verified the lean local study-summary module at commits `4637948`, `f630636`,
and final revision `2adec93`.

Behavior verified:

- fixed typed enums with exact canonical categories, strict hostile-input
  unknown mapping, and explicit disabled no-op behavior;
- lowercase normalized 7–40 hex build SHAs only, ordinary JS plus bounded DOM
  error names, and no compatibility aliases;
- stage entry/duration, command outcome, mechanism, Fit, export/blocker,
  autosave/recovery, image-inference, error-name, and precomputed performance
  summaries;
- privacy exclusion of project data, identity, coordinates, free text, URLs,
  paths, stacks, messages, and replay/pointer/frame work;
- saturating fixed counters/histograms, payload <= 8192 bytes, named 135-array /
  14-scalar memory accounting of 18,768 bytes, and at-most-one normal send plus
  one beacon;
- deterministic analyzer counts, explicit denominators/rates, medians,
  fixed-bucket percentiles, missingness, and build/profile strata;
- default production dist has no study-summary runtime module or endpoint
  string because Sol owns later product wiring.

Assumptions rejected: historical replay, snapshots, durable outbox, retries,
server worker, arbitrary category keys, bug intake, and endpoint constants were
deliberately not reproduced. No worker was necessary because only fixed arrays
and one explicit serialization are used.

Owned files are exactly the six source/test files in commits `4637948`,
`f630636`, and `2adec93`, plus the
G8 evidence files listed in `changed-files.txt`. No product wiring was added.

Historical coverage: the read-only-derived
`historical-dispositions.tsv` lists all 25 currently pending G8 commit rows and
210 currently pending G8 hunk rows from the canonical ledgers (235 rows total).
Old replay/delivery/server/snapshot surfaces are recommended
`DROP_INTENTIONAL`; stable wiring and analysis intent are recommended
`REPLACED_BY_LEAN_TELEMETRY`, with this result as evidence.

Remaining risk: after the mandated removal of the temporary root dependency
symlink, a fresh typecheck cannot find the repository's `node` type package in
this isolated worktree. The required typecheck/build passed before removal;
focused tests and the full test suite passed after removal. The integration
worktree's normal dependency installation resolves this environment-only note.
