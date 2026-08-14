# G4 result

## Question and success criteria

Can MotionSmith keep bounded, local, telemetry-independent autosave evidence
across normal writes, interrupted writes, reload/discard, legacy migration,
multiple tabs, corruption, quota pressure, and large image projects without
claiming a save before the commit finishes, while keeping the persistence
facade compact and behaviorally stable under pure extraction?

## Verified behavior

- `motionsmith.autosave` and `motionsmith.autosave.previous` retain two raw,
  complete project generations after a successful second write.
- `motionsmith.autosave.metadata` records generation, byte count, fingerprints,
  and writer/transaction identity; `motionsmith.autosave.dirty` marks an
  incomplete attempt.
- The write result is `saved` only after current generation, metadata, and dirty
  marker completion. Failed writes return explicit `quota`, `abort`,
  `stale-write`, `corruption`, `unavailable`, or `serialization` reasons.
- Interrupted writes roll back the known keys when possible, retain the prior
  current and previous generations, and leave dirty recovery evidence.
- Prepared plans compare generation/fingerprint tokens, so late tab completion
  is rejected as `stale-write` without overwriting newer data.
- Reload/discard recovery deterministically chooses the current complete
  generation and reports `interrupted-write` when the marker remains.
- Legacy `mechanim.autosave` migration is complete-before-remove and idempotent;
  failed cleanup remains `legacy-unmigrated` instead of being hidden.
- Fingerprint, byte-count, metadata, JSON, and project-schema corruption are
  explicit recovery outcomes; a valid previous generation is used when the
  current one is corrupt.
- Large image payloads save normally or return an explicit quota/failure result;
  they are never silently treated as saved.
- `useProjectAutosave.ts` remains the project autosave lifecycle boundary and
  imports no telemetry or study module. The persistence seam has no telemetry,
  network, IndexedDB, or shared telemetry lifecycle dependency.
- Existing callers continue to read raw canonical autosave JSON, public
  persistence imports remain available through `utils/projectPersistence.ts`,
  and workspace layout storage plus snapshot naming remain behind that facade.
- The exported `STORAGE_KEYS` and `LEGACY_STORAGE_KEYS` contract remains stable;
  the contract test now checks those values directly instead of requiring
  autosave literals to remain in the facade source file.
- Legacy namespace derivation has one owner in
  `utils/projectAutosaveFormat.ts`; the facade re-exports its legacy key object.
- The facade is 142 lines. The extracted format/inspection, transaction, and
  recovery modules are 368, 280, and 227 lines respectively.

## Golden-master gate

`tests/g4-persistence-golden.test.ts` hashes normalized serializable outputs
for preparation, complete commits, stale completion, interrupted recovery,
legacy migration, current-generation fallback, and corrupt metadata. Project
fixtures are explicit; clock, writer, and transaction fields are replaced with
`<volatile>` before hashing.

- Golden SHA-256: `7e6898e0a3f7890e4ef26c68ce4570c62c922b5d4d5f2df300392e6752568254`
- The digest passed unchanged after extraction.

## Evidence

- `bun tests/g4-persistence-golden.test.ts` passed before extraction and again
  after extraction with the unchanged digest above.
- `bun tests/g4-persistence.test.ts` passed after extraction.
- `bun tests/g008-project-review.test.ts` passed after extraction.
- `bun run build` passed after extraction (`tsc && vite build`).
- `git diff --check` passed after extraction.
- `bun tests/project-contract.test.ts` no longer fails at the former line-503
  source-ownership assertion. It reaches the pre-existing fabrication assertion
  at line 1695 (`denseFabrication.buildable` is `false`), so the command exits
  1 for that unrelated baseline failure.
- The full `bun run test` command was run in the prior accepted G4 lane and
  stopped on the existing `tests/mechanism-authored-authority-boundaries.test.ts:117`
  G1 assertion. The prior lane also recorded unrelated fabrication baseline
  failures in `tests/mechanism-v2-schema-inventory.test.ts` and
  `tests/project-contract.test.ts`.
- The prior requested production-preview Playwright flow failed before browser
  startup because local binding returned `EPERM` on `127.0.0.1:5173`; the raw
  output remains in `tests.txt` for the integration owner's Orca gate.

## Owned files

The continuation production edits are limited to
`utils/projectPersistence.ts`, `utils/projectAutosaveFormat.ts`,
`utils/projectAutosaveTransactions.ts`, and
`utils/projectAutosaveRecovery.ts`. The new goal-local test is
`tests/g4-persistence-golden.test.ts`. `hooks/useProjectAutosave.ts` remains
owned by G4 and was unchanged. The only existing test edit is the minimal
storage-ownership assertion adaptation in `tests/project-contract.test.ts`.
No other shared test/helper, controller, history, `ProjectState`, package,
Playwright configuration, or telemetry file was edited.

## Commits

- `dc57109fda08ba6d0cc4ca16c5c1e690ef0b737a` — deterministic G4
  persistence golden-master gate.
- `EXTRACTION_COMMIT_SELF (this commit)` — final autosave extraction,
  contract-test adaptation, single legacy-key owner, and evidence. The final
  commit SHA is reported by the handoff.

## Remaining risk

The lane-local Playwright preview server cannot bind in this sandbox. The
integration owner must run the deciding Orca production-preview recovery gate.
The broader-suite and fabrication failures listed above are pre-existing and
outside this persistence extraction.

## Intentionally omitted behavior

- No persistence output strings, storage keys, recovery selection order, or
  public import names changed.
- No telemetry dependency, event, endpoint, worker, or shared lifecycle.
- No backend, cloud sync, auth, IndexedDB mirror, cache, fake fallback, or
  silent repair.
- No edits to `hooks/useProjectAutosave.ts`, `ProjectState`, history/controller/
  app files, package metadata, Playwright configuration, or any existing test
  beyond the required storage-ownership assertion adaptation.
