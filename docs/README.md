# MotionSmith Docs Map

Status: active docs index
Last refreshed: 2026-06-29

Use this file before adding new docs. If a doc does not fit below, update an existing doc first.

## Active source of truth

- [`../AGENTS.md`](../AGENTS.md) — repo operating contract, architecture discipline, verification gates.
- [`../DESIGN.md`](../DESIGN.md) — UI/UX design contract.
- [`platform-rebuild-porting-flow.md`](platform-rebuild-porting-flow.md) — parent rebuild requirements.
- [`app-command-shortcuts.md`](app-command-shortcuts.md) — app commands, menu items, keyboard shortcuts.
- [`mechanism-reference/`](mechanism-reference/) — physical mechanism, spacer, z-stack, schema, and assembly rules.
- [`mechanism-blueprint-manual.md`](mechanism-blueprint-manual.md) — blueprint/export behavior.
- [`deployment.md`](deployment.md), [`macos-distribution.md`](macos-distribution.md) — distribution notes.

## Active implementation plans

- [`prd/toon-25d-main-3d-unlock-plan.md`](prd/toon-25d-main-3d-unlock-plan.md)
- [`prd/toon-25d-implementation-plan.md`](prd/toon-25d-implementation-plan.md)
- [`prd/toon-25d-test-spec.md`](prd/toon-25d-test-spec.md)
- [`subsystem-governance-and-mechanism-contracts.md`](subsystem-governance-and-mechanism-contracts.md)
- [`analysis/codebase-cleanup-architecture-plan.md`](analysis/codebase-cleanup-architecture-plan.md)

## Historical / evidence docs

Keep these for provenance; do not treat them as current UI contract unless `DESIGN.md` or active plans cite them.

- [`ui-to-web/`](ui-to-web/) — Qt-to-web inventory, screenshots, porting evidence.
- [`ui-pane-tab-redesign-plan.md`](ui-pane-tab-redesign-plan.md) — prior pane redesign notes.
- [`prd/novice-canva-style-ui-plan.md`](prd/novice-canva-style-ui-plan.md) — superseded by `DESIGN.md` + active 2.5D plans.
- [`prd/canva-video-editor-workspace-plan.md`](prd/canva-video-editor-workspace-plan.md) — superseded by current pane/workbench contract.
- [`prd/realistic-25d-3d-physics-platform-plan.md`](prd/realistic-25d-3d-physics-platform-plan.md) — superseded by toon 2.5D main + 3D unlock plan.
- [`assembly-lic-stepper-plan.md`](assembly-lic-stepper-plan.md) — planning provenance; assembly behavior now belongs in `mechanism-reference/05-assembly-process-guides.md` plus implementation tests.
- [`mechanism-driving-plan.md`](mechanism-driving-plan.md) — planning provenance; durable rules belong in `mechanism-reference/03-mechanism-unit-specs.md` and registry tests.
- [`subsystem-governance-execution-log.md`](subsystem-governance-execution-log.md) — session log, not product spec.

## Local-only / ignored references

- `docs/to-port-web-onnx/` is ignored. Keep only small summaries in docs. Large copied repos belong outside this repo under local archive.
- `.omx/`, `.agents/`, `dist/`, `src-tauri/target/`, `node_modules/`, `test-results/` are local/runtime/build state, not documentation.
