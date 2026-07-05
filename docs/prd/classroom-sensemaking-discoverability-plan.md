# Classroom Sensemaking Discoverability Plan

Status: active planning artifact
Last refreshed: 2026-07-05
Scope: mechanism meaning, classroom takeaways, short clips, direct hints, and assessment hooks across Foundry, Design, Blueprint, and Assembly.

## Field signal

Teachers missed the existing sensemaking entry point. That means the feature was not discoverable enough for a classroom where users do not open optional exploration panels. MotionSmith must make mechanism meaning visible at the moment of choosing, fitting, testing, and assembling a mechanism.

The product change is not to add more tutorial text. The change is to make the mechanism itself explainable through the workbench: motion preview, one-line meaning, direct cause/action hints, tiny application cues, and quick checks.

## Principles

1. **Visible before optional.** A student must see the mechanism meaning without opening a hidden panel.
2. **Direct translation.** Each mechanism gets a plain visible mapping: `input action -> physical cause -> output motion`.
3. **Clip as a spark, not a dependency.** Short YouTube-style clips or generated loop previews can create a wow moment, but the app must still work offline after assets are cached and must not require streaming.
4. **Cause/action hints.** Hints name the blocked object and one next action. No generic instructions.
5. **Teacher takeaway.** Every classroom mechanism exposes one learning connection and one quick assessment/check.
6. **Center canvas stays a workbench.** No essay cards, video galleries, or sidecar readings in the canvas.
7. **No server scope.** No accounts, cloud media hosting, analytics, teacher dashboard, LMS sync, or student tracking.

## Research anchors

- Short educational video should control cognitive load and keep students active. MotionSmith should use compact 15-90 second clips or generated loops next to a manipulable mechanism, not long passive videos. Sources: https://www.vanderbilt.edu/brightspace/2016/04/04/considerations-for-effectively-creating-educational-videos/ and https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf
- UDL guidance supports multiple ways to perceive, act, and communicate. MotionSmith should pair visual motion, short labels, direct handles, and one-tap checks. Source: https://udlguidelines.cast.org/
- Formative feedback should be timely, specific, supportive, and tied to learner action. MotionSmith blocker chips should use `Cause -> Action` phrasing tied to the object being edited. Source: https://journals.sagepub.com/doi/10.3102/0034654307313795
- Classroom learning benefits from formative assessment and feedback loops. MotionSmith teacher-pack checks should be local, low-stakes, and focused on the visible mechanism. Sources: https://www.nationalacademies.org/read/24783/chapter/9 and https://pdf.retrievalpractice.org/guide/McDaniel_Agarwal_etal_2011_JEP.pdf

## Product model

Replace the hidden idea of `Sensemaking` with a visible, compact mechanism cue named by outcome:

- Left pane card: `Why it moves`
- Foundry toolbar toggle: `Meaning`, optional, for expanded details only
- Status chip: `Cause -> Action`
- Teacher pack field: `Takeaway`

The word `Sensemaking` can remain in docs and internal code, but the student-facing UI should use direct language.

## Mechanism sensemaking contract

Each mechanism feature must carry a small classroom meaning object in the shared mechanism metadata path, not in a stage component:

```ts
{
  directTranslation: "Crank turns -> rocker swings",
  bestFor: "Swing",
  applicationCue: "Waving arm",
  clipSlot: "generated-loop",
  tryThis: "Drag the output joint and watch the arc",
  commonHint: "Link too short -> Fit path",
  teacherTakeaway: "Rotary motion can become oscillating motion",
  studentCheck: "Point to the driver",
  expectedAnswer: "The crank is the driver",
  evidenceCue: "driver turns while the rocker output swings"
}
```

This belongs behind the same mechanism seams as `label`, `sense`, `goodFor`, fabrication recipe, kinematics, and interaction policy. Foundry, Design, Blueprint, and Assembly must read the same object.

## Mechanism matrix

| Mechanism | Visible direct translation | Application cue | Quick check | Hint style |
| --- | --- | --- | --- | --- |
| Four-bar linkage | `Crank turns -> rocker swings` | Waving arm, waving sign, flapping wing | `Which pivot is fixed?` | `Link cannot close -> Fit path or choose Broad sweep` |
| Slider piston | `Crank turns -> slider pushes` | Pump, punch, piston, pop-up | `Which part moves straight?` | `Slider off guide -> Snap guide to path` |
| Cam follower | `Cam shape -> follower lifts` | Bobbing head, jumping figure, timed lift | `Where does the follower touch?` | `Follower not touching -> Move guide to cam edge` |
| Gear train | `Touching teeth -> spin transfers` | Reversing sign, speed change, spinner | `Which gear turns opposite?` | `Teeth overlap -> Snap axle to valid mesh distance` |
| Gear linkage | `Two driven gears -> linked point moves` | Coordinated arms, compound loop | `Which gears are drivers?` | `Link holes miss -> Use matched linkage length` |
| Planetary gear | `Sun, planets, ring -> compact rotation` | Compact spinner, reducer demo | `Which part is fixed?` | `Planet off ring -> Reset to kit geometry` |
| Five-bar | `Two cranks -> one trace point` | Advanced path drawing | `Which two inputs drive it?` | `Trace breaks -> Reset phase pair` |
| Six-bar | `Four-bar plus dyad -> richer arc` | Advanced puppet motion | `Which link follows the base?` | `Dyad overextends -> Reset preset` |
| Scotch yoke | `Pin in slot -> straight back-forth` | Reciprocating slider demo | `Where is the slot?` | `Pin outside slot -> Reset slot alignment` |
| Quick-return | `Offset link -> slow out, fast back` | Tool stroke demo | `Which stroke is faster?` | `No rotation possible -> Reset range` |
| Rack and pinion | `Gear teeth -> rack slides` | Steering/rack demo | `Which part is linear?` | `Rack not tangent -> Align pinion to rack` |
| Crank driver | `Driver sets phase` | Internal driver/timing only | `Where is the input?` | `No output -> Choose a full mechanism` |

Authorable/buildable mechanisms should appear first. Simulation-only mechanisms must carry a visible `Simulation only` badge until fabrication recipes are complete.

## UI placement

### Getting Started / lesson entry

- Keep starter cards result-first: `Waving arm`, `Blank character`, `Girl`, `Boy`, `Image`, `Package`.
- Add lesson cards only when they create real `ProjectState` data: character, path, compatible mechanism, and reset baseline.
- Do not make users find meaning through a hidden exploration panel.

### Mechanism Foundry

- Every mechanism card shows: motion icon, `Best for`, direct translation, and one tiny `Try` affordance.
- Selected mechanism shows a one-line `Why it moves` chip above parameters.
- Expanded `Meaning` shows optional clip, takeaway, quick check, and common failure fix.
- Clip source order: generated loop from current preset, bundled local clip asset, optional external URL. External URLs are optional enrichment, never a blocker.

### Mechanism Design

- Reuse the same `Why it moves` chip from Foundry.
- When a path fit fails, show the nearest cause/action hint at the selected path or handle.
- Do not duplicate Foundry mechanism descriptions in Design; the mechanism object owns the wording.

### Path Editor and Character

- Path Editor shows only path-specific cause/action hints: too few points, path too wide, missing anchor, IK chain mismatch.
- Character shows part/joint hints only while editing: missing joint, locked part, outline not closed.
- No mechanism theory in Character.

### Blueprint

- Blueprint uses the same mechanism meaning only as a tiny label on the generated artifact: `Four-bar linkage: crank turns -> rocker swings`.
- Blueprint remains a build-file screen, not the learning explanation screen.

### Assembly

- Assembly shows the learning connection through action: highlight driver, moving output, and final character motion.
- Each step can show one `Why` chip only when it explains the current action: `Spacer keeps links apart`, `Fixed pivot stays on board`, `Output link drives wrist`.
- Teacher pack exports the same takeaway and check prompts.

## Hint taxonomy

All hints use this format:

`Object + cause -> action`

Examples:

- `Right hand path has 2 points -> draw one more point`
- `Four-bar link cannot close -> choose Broad sweep`
- `Gear teeth overlap -> move axle to next valid hole`
- `Cam follower floats -> slide guide until roller touches`
- `Planet gear off ring -> reset planetary kit`
- `Wrist path only moves one part -> choose wrist-to-elbow chain`
- `Assembly stack collides -> increase spacer layer`

A hint may offer one secondary action only when safe: `Reset preset`.

## Assessment pattern

Assessment is local, formative, and one-tap. No scores, accounts, analytics, or dashboards.

Per mechanism template:

- `Point to the driver`
- `Choose the output motion`
- `Predict what changes if the crank gets longer`
- `Which part must stay fixed?`
- `Where should the spacer go?`

Teacher pack output:

- mechanism name in readable terms
- application cue
- direct translation
- quick check prompt
- expected answer
- visual evidence cue
- reset link to the local lesson state

## Clip policy

Use clips sparingly.

Required clip behavior:

- 30-60 seconds maximum or a short loop.
- Muted by default.
- Does not autoplay when reduced-motion is active.
- Poster/thumbnail visible before playback.
- If an external YouTube URL is present, open it as optional enrichment or embed only after explicit user action.
- App remains fully usable when network/video loading fails.

Preferred source:

1. Generated loop from the same kinematic/fabrication preset.
2. Bundled local classroom clip.
3. Teacher-provided optional URL.

## Implementation plan

### Phase 0 — Contract and content schema

- Add this PRD to the docs map and project contracts.
- Extend mechanism metadata with a small `classroomSensemaking` object.
- Require every `ALL_MECHANISM_TYPES` entry to define direct translation, application cue, quick check, and common hint.

Done when contract tests fail if any mechanism lacks sensemaking metadata.

### Phase 1 — Foundry discoverability

- Replace hidden-first sensemaking with always-visible card cues.
- Keep expanded details optional under `Meaning`.
- Promote one `Why it moves` chip for the selected mechanism.
- Badge non-authorable mechanisms as `Simulation only` or keep them out of the default classroom list.

Done when a browser test finds mechanism meaning without pressing an extra exploration button.

### Phase 2 — Specific hints

- Create a central hint mapper for path, IK, mechanism, fabrication, and assembly blockers.
- Use `Cause -> Action` copy only.
- Route warnings to the relevant object: path point, joint, mechanism handle, board coordinate, stack layer.

Done when generic hint copy is removed from classroom-critical flows.

### Phase 3 — Clip slots and generated loops

- Add optional clip metadata to mechanism sensemaking.
- Prefer generated loops from existing simulation samples before adding media files.
- Add reduced-motion and network-failure fallbacks.

Done when a mechanism can show a tiny loop/thumbnail and still work with video unavailable.

### Phase 4 — Teacher checks and pack export

- Add per-mechanism quick checks to lesson state and teacher pack output.
- Keep checks local and printable/exportable.
- Do not store student answers remotely.

Done when `Waving arm` exports a teacher-readable takeaway/check without any server dependency.

### Phase 5 — Cross-tab consistency

- Foundry, Design, Blueprint, and Assembly read the same mechanism sensemaking metadata.
- Design cannot invent different wording for the same mechanism.
- Assembly uses the same direct translation and takeaway but presents it through build steps.

Done when a contract test verifies one source of truth for mechanism meaning.

## Implementation snapshot — 2026-07-02

Completed first production slice:

- Every mechanism template now owns a shared `classroomSensemaking` object with direct translation, application cue, try action, common hint, teacher takeaway, student check, expected answer, visual evidence cue, and generated-loop clip slot.
- Foundry, Mechanism Design, Blueprint, and Assembly read the same metadata and show a compact visible cue before optional detail drawers.
- Guided lesson metadata reuses the same direct translation shape so entry cards and downstream mechanism views do not drift.
- Contract tests fail if a mechanism or classroom lesson loses required sensemaking fields; browser tests verify visible cues in Foundry, Design, Blueprint, and Assembly.

Remaining expansion:

- Convert more blocker warnings to the central `object + cause -> action` hint taxonomy.
- Add local clip assets or optional external clip URLs only after generated-loop fallbacks remain usable offline.

## Implementation snapshot — 2026-07-05

Completed classroom-configuration slice:

- Added a local classroom assessment key model so schools can select bundled prompt sets by project setting or URL query (`?assessment=` / `?assessmentKey=`) without server accounts or dashboards.
- Kept unknown assessment slugs as requested keys while resolving visible prompts to the bundled default, so future teacher- or school-provided bundles can attach to the same key without rewriting saved projects.
- Added default and `motion-journal` assessment bundles behind one content seam, with prompts shared by Foundry, Mechanism Design, and Assembly instead of stage-local copy.
- Added per-mechanism use examples with generated-loop-first classroom video slots and optional click-to-load YouTube no-cookie embeds.
- Rendered generated loops from the same mechanism defaults and simulation preview path used by the workbench, preserving the generated-loop fallback when external video is unavailable or reduced motion is active.

Remaining expansion:

- Load teacher-authored assessment bundles from a local imported package, Options key, or future static classroom pack while keeping `ProjectState` to the selected key only.
- Add locale-ready bundle files before exposing multilingual UI; runtime UI remains English-only until the product language contract changes.
- Curate and periodically review optional external video ids; external media must remain enrichment, never a required classroom dependency.
- Extend teacher-pack and printable outputs to include the active assessment key, prompt set label, mechanism use example, and reflection prompt.

## Verification plan

- Contract tests:
  - this PRD is registered in `docs/README.md` and `docs/prd/README.md`.
  - every mechanism has direct translation, application cue, quick check, and common hint in shared metadata.
  - the plan excludes server/cloud/dashboard scope.
- Browser tests:
  - Foundry shows `Why it moves` without opening an exploration drawer.
  - selecting `Four-bar linkage` shows `Crank turns -> rocker swings` and a specific fit hint when broken.
  - Assembly shows only one current-step why chip and no overlapping explanation panels.
  - video loading failure leaves the mechanism usable and shows a poster/fallback.

## Non-goals

- No teacher dashboard.
- No student account, classroom roster, analytics, cloud save, or LMS integration.
- No required YouTube dependency.
- No center-canvas tutorial panel.
- No fake mechanism clips.
- No hidden default mechanism in blank projects.
