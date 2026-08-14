# G0 worker interface freeze

G0 makes no production-code change. Until G1 finishes, workers must treat the committed `ProjectState` shape and current exported module signatures as immutable.

- G4 may change only `hooks/useProjectAutosave.ts` and `utils/projectPersistence.ts`; any required `ProjectState`, history, or controller edit returns to Sol as a separate patch request.
- G5 may change only its image/ONNX roots; it must return any renderer-lifecycle requirement rather than editing G3 files.
- G6 owns configuration, workflows, versions, and packaging. It must not add telemetry runtime wiring or change product-domain semantics.
- G2 remains deferred until G1 freezes edit-authority and fabrication-domain types.
- G3 remains deferred until G1 commits the accepted/rejected/no-op command boundary.
- G7 and G8 remain deferred by their declared dependencies.

The zero-overlap evidence is `production-file-ownership.tsv` and `ownership-audit.md`.
