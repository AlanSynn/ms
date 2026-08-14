# Quality-pass ledger schema

`commit-ledger.tsv` contains exactly the 82 historical commits named by the execution plan. G0 assigns primary lanes without asserting that baseline behavior is correct.

Interim states:

- `PENDING_VERIFICATION`: routed but not independently verified.
- `PENDING_HUNK_VERIFICATION`: mixed commit; see `hunk-ledger.tsv`.
- `PENDING_LEAN_REPLACEMENT`: telemetry-primary evidence awaits G8/G9 disposition.

Final dispositions are restricted to:

- `VERIFIED_CLEAN_IMPLEMENTATION`
- `REWORK_REQUIRED`
- `DROP_INTENTIONAL`
- `REPLACED_BY_LEAN_TELEMETRY`

The final ledger must cite deciding tests or inspected artifacts and the accepted integration commit where applicable.
