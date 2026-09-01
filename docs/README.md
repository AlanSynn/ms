# MotionSmith Docs Map

Status: active docs index
Last refreshed: 2026-08-31

Use this file before adding new docs. If a doc does not fit below, update an existing doc first.

For current tab, pane, button, and tooltip UX, use `workbench-flow-ux-contract.md`. Do not create new per-tab UX contract docs; update that file instead.

## Active source of truth

- [`../AGENTS.md`](../AGENTS.md) — repo operating contract, architecture discipline, verification gates.
- [`workbench-flow-ux-contract.md`](workbench-flow-ux-contract.md) — canonical tab/pane/button/tooltip flow contract and UX drift ledger.
- [`app-command-shortcuts.md`](app-command-shortcuts.md) — app commands, menu items, keyboard shortcuts.
- [`mechanism-reference/`](mechanism-reference/) — physical mechanism, spacer, z-stack, schema, and assembly rules.
- [`mechanism-blueprint-manual.md`](mechanism-blueprint-manual.md) — blueprint/export behavior.
- [`deployment.md`](deployment.md), [`macos-distribution.md`](macos-distribution.md) — distribution notes.

## Active product evidence / remaining-risk PRDs

- [`chromebook-feature-audit.md`](chromebook-feature-audit.md) — current 6× CPU emulation evidence for short interaction, memory, playback, and bundle gates; physical-device and ten-minute boundaries are explicit.
- [`prd/toon-25d-main-3d-unlock-plan.md`](prd/toon-25d-main-3d-unlock-plan.md)
- [`prd/toon-25d-implementation-plan.md`](prd/toon-25d-implementation-plan.md)
- [`prd/toon-25d-test-spec.md`](prd/toon-25d-test-spec.md)
- [`prd/novice-canva-style-ui-plan.md`](prd/novice-canva-style-ui-plan.md) — active novice flow and tutorial/help plan.
- [`prd/classroom-field-support-plan.md`](prd/classroom-field-support-plan.md) — classroom field-study gap plan: web-first release, guided lesson templates, sensemaking, stable reset, and animated assembly.
- [`prd/classroom-guided-entry-plan.md`](prd/classroom-guided-entry-plan.md) — teacher-feedback plan for theme-first classroom entry, starter ownership, and guided project templates.
- [`prd/classroom-sensemaking-discoverability-plan.md`](prd/classroom-sensemaking-discoverability-plan.md) — teacher-feedback plan for visible mechanism meaning, direct hints, optional clips, and classroom checks.
- [`prd/assembly-step-player-redesign-plan.md`](prd/assembly-step-player-redesign-plan.md) — active Assembly redesign plan: one-step visual build player, step-local parts, board mount, and character attach flow.
- [`prd/foundry-assembly-ssot-plan.md`](prd/foundry-assembly-ssot-plan.md) — active Foundry/Design/Assembly SSOT plan for mechanism visuals, `MechanismSceneContract`, and z-only assembly explode.
- [`prd/mechanism-workbench-instance-board-plan.md`](prd/mechanism-workbench-instance-board-plan.md) — active multi-instance, scene-object target, and 15×15 board-fit plan.
- [`subsystem-governance-and-mechanism-contracts.md`](subsystem-governance-and-mechanism-contracts.md)
- [`analysis/codebase-cleanup-architecture-plan.md`](analysis/codebase-cleanup-architecture-plan.md)

## Completed implementation contracts

- [`prd/mechanism-fit-flow-hardening.md`](prd/mechanism-fit-flow-hardening.md) — implemented user-path → Foundry fit → Design → Blueprint/Assembly continuity contract. Use as behavior evidence, not an active plan.

## Current refactor cockpit

- Start with [`analysis/codebase-cleanup-architecture-plan.md`](analysis/codebase-cleanup-architecture-plan.md) before moving code. It tracks completed seams, the next safe slice, and deferred high-risk boundaries.
- Use [`subsystem-governance-and-mechanism-contracts.md`](subsystem-governance-and-mechanism-contracts.md) for subsystem ownership and harness rules.
- Lock pure extractions in [`../tests/project-contract.test.ts`](../tests/project-contract.test.ts), then run the targeted production-preview Playwright flow for any touched UI/workbench path.

## Historical / evidence docs

Keep these for provenance; do not treat them as current UI contract unless active plans cite them.

- [`ui-to-web/`](ui-to-web/) — Qt-to-web inventory, screenshots, porting evidence.
- [`ui-pane-tab-redesign-plan.md`](ui-pane-tab-redesign-plan.md) — historical pane redesign notes; current contract is `workbench-flow-ux-contract.md` plus `subsystem-governance-and-mechanism-contracts.md`.
- [`prd/canva-video-editor-workspace-plan.md`](prd/canva-video-editor-workspace-plan.md) — superseded by current pane/workbench contract.
- [`prd/realistic-25d-3d-physics-platform-plan.md`](prd/realistic-25d-3d-physics-platform-plan.md) — superseded by toon 2.5D main + 3D unlock plan.
- [`assembly-lic-stepper-plan.md`](assembly-lic-stepper-plan.md) — planning provenance; assembly behavior now belongs in `mechanism-reference/05-assembly-process-guides.md` plus implementation tests.
- [`mechanism-driving-plan.md`](mechanism-driving-plan.md) — planning provenance; durable rules belong in `mechanism-reference/03-mechanism-unit-specs.md` and registry tests.
- [`subsystem-governance-execution-log.md`](subsystem-governance-execution-log.md) — session log, not product spec.

## Local-only / ignored references

- `.omx/`, `.agents/`, `dist/`, `src-tauri/target/`, `node_modules/`, `test-results/` are local/runtime/build state, not documentation.
