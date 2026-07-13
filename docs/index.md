# Documentation Index (Hot / Cold / Index)

Last refreshed: 2026-07-13

## Hot (active contracts)

Use these first for implementation decisions, planning, and validation.

- [`../AGENTS.md`](../AGENTS.md)
- [`README.md`](../README.md)
- [`app-command-shortcuts.md`](app-command-shortcuts.md)
- [`workbench-flow-ux-contract.md`](workbench-flow-ux-contract.md)
- [`subsystem-governance-and-mechanism-contracts.md`](subsystem-governance-and-mechanism-contracts.md)
- [`mechanism-blueprint-manual.md`](mechanism-blueprint-manual.md)
- [`deployment.md`](deployment.md)
- [`macos-distribution.md`](macos-distribution.md)
- [`mechanism-reference/`](mechanism-reference/)
- [`mechanism-reference/00-symbols-coordinate-system.md`](mechanism-reference/00-symbols-coordinate-system.md)
- [`mechanism-reference/01-physical-kit-parts.md`](mechanism-reference/01-physical-kit-parts.md)
- [`mechanism-reference/02-spacers-and-stacks.md`](mechanism-reference/02-spacers-and-stacks.md)
- [`mechanism-reference/03-mechanism-unit-specs.md`](mechanism-reference/03-mechanism-unit-specs.md)
- [`mechanism-reference/04-portable-schema-and-validation.md`](mechanism-reference/04-portable-schema-and-validation.md)
- [`mechanism-reference/05-assembly-process-guides.md`](mechanism-reference/05-assembly-process-guides.md)
- [`analysis/codebase-cleanup-architecture-plan.md`](analysis/codebase-cleanup-architecture-plan.md)
- [`analysis/fabrication-parity-2026-07-13.md`](analysis/fabrication-parity-2026-07-13.md)

### Active PRD set (required for current feature planning)

- [`prd/toon-25d-main-3d-unlock-plan.md`](prd/toon-25d-main-3d-unlock-plan.md)
- [`prd/toon-25d-implementation-plan.md`](prd/toon-25d-implementation-plan.md)
- [`prd/toon-25d-test-spec.md`](prd/toon-25d-test-spec.md)
- [`prd/novice-canva-style-ui-plan.md`](prd/novice-canva-style-ui-plan.md)
- [`prd/classroom-field-support-plan.md`](prd/classroom-field-support-plan.md)
- [`prd/classroom-guided-entry-plan.md`](prd/classroom-guided-entry-plan.md)
- [`prd/classroom-sensemaking-discoverability-plan.md`](prd/classroom-sensemaking-discoverability-plan.md)
- [`prd/assembly-step-player-redesign-plan.md`](prd/assembly-step-player-redesign-plan.md)
- [`prd/foundry-assembly-ssot-plan.md`](prd/foundry-assembly-ssot-plan.md)
- [`prd/mechanism-workbench-instance-board-plan.md`](prd/mechanism-workbench-instance-board-plan.md)
- [`prd/mechanism-fit-flow-hardening.md`](prd/mechanism-fit-flow-hardening.md)
- [`prd/feasible-only-mechanism-editing-plan.md`](prd/feasible-only-mechanism-editing-plan.md)

### Active mechanism specs

- [`prd/mechanisms/4bar-linkage-prd.md`](prd/mechanisms/4bar-linkage-prd.md)
- [`prd/mechanisms/5bar-linkage-prd.md`](prd/mechanisms/5bar-linkage-prd.md)
- [`prd/mechanisms/cam-follower-prd.md`](prd/mechanisms/cam-follower-prd.md)
- [`prd/mechanisms/foundry-input-and-verification-prd.md`](prd/mechanisms/foundry-input-and-verification-prd.md)
- [`prd/mechanisms/gear-linkage-prd.md`](prd/mechanisms/gear-linkage-prd.md)
- [`prd/mechanisms/gear-train-prd.md`](prd/mechanisms/gear-train-prd.md)
- [`prd/mechanisms/planetary-gear-prd.md`](prd/mechanisms/planetary-gear-prd.md)

## Cold (historical / superseded / provenance only)

Keep for provenance and rollback reasoning, but do not use as default context.

- [`archive/analysis/README.md`](archive/analysis/README.md)
- [`archive/plans/README.md`](archive/plans/README.md)
- [`archive/ui/README.md`](archive/ui/README.md)
- [`archive/ports/README.md`](archive/ports/README.md)
- [`archive/execution/README.md`](archive/execution/README.md)
- [`archive/misc/README.md`](archive/misc/README.md)
- [`archive/analysis/fabrication-board-canonicalization-2026-07-07.md`](archive/analysis/fabrication-board-canonicalization-2026-07-07.md)

- [`archive/plans/assembly-lic-stepper-plan.md`](archive/plans/assembly-lic-stepper-plan.md)
- [`archive/ui/ui-pane-tab-redesign-plan.md`](archive/ui/ui-pane-tab-redesign-plan.md)
- [`archive/plans/design-automata-unified-scene-plan.md`](archive/plans/design-automata-unified-scene-plan.md)
- [`archive/plans/realistic-25d-3d-physics-platform-plan.md`](archive/plans/realistic-25d-3d-physics-platform-plan.md)
- [`archive/plans/canva-video-editor-workspace-plan.md`](archive/plans/canva-video-editor-workspace-plan.md)
- [`archive/ui/ui-dead-feature-audit.md`](archive/ui/ui-dead-feature-audit.md)
- [`archive/plans/platform-rebuild-porting-flow.md`](archive/plans/platform-rebuild-porting-flow.md)
- [`archive/execution/subsystem-governance-execution-log.md`](archive/execution/subsystem-governance-execution-log.md)
- [`archive/plans/mechanism-driving-plan.md`](archive/plans/mechanism-driving-plan.md)
- [`adr/2026-06-27-high-performance-3d-physics-stack.md`](adr/2026-06-27-high-performance-3d-physics-stack.md)
- [`archive/ports/to-port-web-onnx/`](archive/ports/to-port-web-onnx/)
- [`archive/misc/z_axis_layering.md`](archive/misc/z_axis_layering.md)
- All `.omx/context/*.md` and `.omx/state/*` runtime notes (tooling state, not product docs)

## Index rails (where each family is maintained)

- Family maps:
  - [`docs/README.md`](README.md) (single-source entrypoint)
  - [`docs/prd/README.md`](prd/README.md) (PRD-only map)
  - [`docs/analysis/README.md`](analysis/README.md) (audit map)
  - [`docs/mechanism-reference/README.md`](mechanism-reference/README.md)
  - [`docs/observability/README.md`](observability/README.md)
  - [`docs/sessions/README.md`](sessions/README.md)
  - [`docs/adr/README.md`](adr/README.md)

## Outdated/low-value doc cleanup policy

Before adding new context, check:
1. Is it an active contract? keep in Hot.
2. Is it historical/provenance? keep in Cold.
3. Is it obsolete + unused? delete and record in session notes.
