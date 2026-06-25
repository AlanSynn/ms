# MotionSmith / MechAnim Design Contract

Status: active  
Last refreshed: 2026-06-25  
Primary reference: user-provided Stitch MotionSmith editor HTML + `docs/ui-to-web/*`

## Product promise

MotionSmith should feel like a friendly in-browser editor: Canva-simple for novices, video-player-familiar for playback, and precise enough for mechanism/blueprint work. The interface must make the core workflow obvious:

1. Choose or load a character.
2. Select a body part.
3. Draw a free motion path directly on the shared canvas.
4. Pick/simulate a mechanism.
5. Tune parameters while the character, path, and mechanism stay aligned.
6. Export a blueprint and assembly guide from the same scene state.

No tab should feel like a separate app. Except for the onboarding/character import screen, workflow tabs share the same workbench shell, viewport, grid, status strip, and animation controls.

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

### Onboarding

The Character Selection stage may be full-screen. It should remain template-led and novice-friendly, with starter images visibly grey/placeholder-like and package/import actions close by.

### Shared editor workbench

All post-onboarding workflow stages use the same shell:

- **Top header:** MotionSmith/MechAnim brand, numbered workflow steps, command menus, quick import/save/export.
- **Left rail:** project card, high-level workspace shortcuts, and compact scene stats.
- **Center workbench:** shared canvas-feeling viewport with 2cm grid styling and persistent viewport state.
- **Context panels:** each stage may render its own path/foundry/design/blueprint controls inside the workbench, but not replace the global app shell.
- **Player dock:** floating animation controls are always available in workflow tabs.
- **Bottom status:** workflow status strip + status bar remain the technical feedback channel.

The workbench must preserve `canvasViewport` across Path Editor, Mechanism Design, and Blueprint Export. Stage switching must not reset zoom/pan or lose selected part/path/mechanism state.

### Pane ownership amendment

Post-onboarding workflow tabs must use a strict three-pane responsibility model:

- **Left pane:** stage workflow, object lists, sensemaking, blocker/next-action status, and primary stage actions.
- **Center pane:** pure shared work canvas only — sheet/grid, character, paths, mechanisms, blueprint overlays, handles, and short in-canvas hints.
- **Right pane:** selected-item inspector only — numeric parameters, bindings, toggles, warnings, and advanced fine tuning.

Do not put broad galleries, recipe lists, onboarding choices, or primary navigation in the right inspector. Do not put parameter forms or scrollable explanation panels inside the center canvas area.

## Interaction principles

- **Novice first:** buttons should read like actions: “Draw free path”, “Use this mechanism”, “Generate package”.
- **Direct manipulation:** paths are drawn on the canvas; IK/mechanism preview updates from real project state.
- **Sensemaking beside controls:** mechanism cards must explain what the mechanism does, what it is good for, and constraints.
- **Real workflow only:** no placeholder simulation, fake recommendations, or mock AI panels. If ONNX is used, it is browser-local Web ONNX and produces actual project state.
- **One source of truth:** body parts, skeleton joints, paths, mechanisms, blueprint positions, and assembly metadata all come from canonical `ProjectState`.

## Component rules

- Keep React/Vite and the existing inline CSS utility system in `index.html`; do not introduce Tailwind/CDN/build-tool dependencies.
- Keep `SceneSketch` for path drawing and `Canvas` for mechanism/blueprint rendering until a tested shared scene component exists. Do not over-unify canvas engines just for style.
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

