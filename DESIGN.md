# MotionSmith Design Contract

Status: active
Last refreshed: 2026-08-20
Primary reference: user-provided Stitch MotionSmith editor HTML + `docs/ui-to-web/*`
Project governance: `AGENTS.md` defines the standing tinkerable-workbench, 3D physics, and fabrication rules for all agents.

## Product promise

MotionSmith should feel like a friendly in-browser editor: Canva-simple for novices, video-player-familiar for playback, and precise enough for mechanism/blueprint work. The interface must make the core workflow obvious:

1. Open the compact Getting Started dialog to choose a starter or load a character.
2. Select a body part.
3. Draw a free motion path directly on the shared canvas.
4. Pick/simulate a mechanism.
5. Tune parameters while the character, path, and mechanism stay aligned.
6. Export a blueprint and assembly guide from the same scene state.

No tab should feel like a separate app. The static logo boot loader and Getting Started dialog may float above the editor, but every workflow tab shares the same workbench shell, viewport, grid, status strip, and animation controls.

## Visual direction

Use a light MotionSmith editor style, not the older dark cyber-industrial direction.

- Background: `#f8f9ff` with a subtle 40px canvas grid.
- Primary: violet `#8b5cf6` for current steps, primary buttons, scrubber thumbs, and selected UI.
- Secondary: emerald `#10b981` for simulation-active / valid / applied states.
- Tertiary: pink `#f472b6` for export emphasis and path accents when needed.
- Text: slate `#1e293b`; muted slate `#64748b`.
- Panels: white or translucent white glass, 1px `#e2e8f0` stroke, large 1.5–2rem radii, soft violet-tinted shadows.

Avoid: dark CAD chrome, tiny low-contrast controls, dense ungrouped lists, fake mockup panels, and isolated per-tab canvases.

## Layout contract

### Splash and Getting Started

The startup splash is the static boot loader only: MotionSmith mark, wordmark, and version. It disappears when the editor is ready, does not teach, and must not show galleries, embedded videos, or starter choices.

Getting Started is a compact modal dialog shown after the boot loader unless the student checked the session-only opt-out; it can also be reopened from the Character/Getting Started action. It is not a full-screen stage. It shows result-first starter choices: Guide, Starter rig, and Character file. Open full project is secondary. Image recognition and its Boy/Girl recognition starters are not shipped. Process/explanation copy stays out. The Guide tile opens guided project cards; closing always lands on the Character tab with the editor shell still visible underneath.

### Character tab

The Character tab is functional, not promotional. It exposes body-part selection, artwork surface controls, skeleton anchors, package review status, import actions, and a 2.5D/3D character preview. It must not contain starter galleries, hero copy, full-screen onboarding, videos, or duplicate Getting Started templates.

### Shared editor workbench

All post-onboarding workflow stages use the same shell:

- **Top header:** MotionSmith brand, numbered workflow steps, command menus, quick import/save/export.
- **Left rail:** project card, high-level workspace shortcuts, and compact scene stats.
- **Center workbench:** shared canvas-feeling viewport with 2cm grid styling and persistent viewport state.
- **Context panels:** each stage may render its own path/foundry/design/blueprint controls inside the workbench, but not replace the global app shell.
- **Player dock:** floating animation controls are always available in workflow tabs.
- **Bottom status:** workflow status strip + status bar remain the technical feedback channel.

The workbench must preserve `canvasViewport` across Path Editor, Mechanism Design, and Blueprint Export. Stage switching must not reset zoom/pan or lose selected part/path/mechanism state.

### Pane ownership amendment

Post-onboarding workflow tabs must use a strict three-pane responsibility model:

- **Left pane:** stage workflow, object lists, sensemaking, blocker/next-action status, and primary stage actions.
- **Center pane:** pure shared work canvas only — sheet/grid, character, paths, mechanisms, blueprint overlays, handles, and the zoom toolbar.
- **Right pane:** selected-item inspector only — numeric parameters, bindings, toggles, warnings, and advanced fine tuning.

Do not put broad galleries, recipe lists, onboarding choices, primary navigation, lens switchers, renderer sidecars, parameter forms, or scrollable explanation panels inside the center canvas area.

## Interaction principles

- **Novice first:** buttons should read like actions: “Draw free path”, “Use this mechanism”, “Generate package”.
- **Direct manipulation:** paths are drawn on the canvas; IK/mechanism preview updates from real project state.
- **Sensemaking beside controls:** mechanism cards must explain what the mechanism does, what it is good for, and constraints.
- **Real workflow only:** no placeholder simulation, fake recommendations, mock AI panels, or image-recognition download. Local character packages and starters produce actual project state.
- **One source of truth:** body parts, skeleton joints, paths, mechanisms, blueprint positions, and assembly metadata all come from canonical `ProjectState`.

## Component rules

- Keep React/Vite and the existing inline CSS utility system in `index.html`; do not introduce Tailwind/CDN/build-tool dependencies.
- Keep `ThreePuppetPreview` as the shared Character/Path/Blueprint scene surface: Path uses its front camera for the 2D authoring view and its orbit camera for 3D inspection, while Blueprint uses the same scene for component preview. SVG renderers remain export-only. Keep shared `ThreeFoundryPreview` for Foundry and Assembly mechanism scenes. Design must consume shared mechanism/fabrication telemetry and must not invent stack, z-order, or pin rules. Do not revive `Canvas.tsx` or add an SVG editing surface.
- Use existing components/state paths before adding abstractions.
- Add test IDs only for persistent product contracts such as shared workbench, sidebar, workflow steps, and player dock.

## Verification expectations

Every layout change must preserve:

- end-to-end browser workflow: character → path → foundry → design → blueprint;
- free path drawing coordinates;
- skeleton/body-part visibility;
- mechanism animation/IK transform evidence;
- zoom persistence across tabs;
- blueprint/assembly guide export;
- contract tests and production build.
