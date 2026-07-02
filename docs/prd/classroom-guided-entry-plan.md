# Classroom Guided Entry Plan

Status: active planning artifact
Last refreshed: 2026-07-02
Scope: theme-first classroom entry, guided starter templates, ownership after a working baseline, and compact tutorial affordances.

## Field signal

Recent teacher feedback changes the entry assumption. The earlier hypothesis was that open exploration and guided entry could be equally prominent. The field signal was stronger: **Guided theme entry is primary**, and **open exploration is secondary** until a student has a working starter they can understand and personalize.

Teachers repeatedly asked for a clearer start because they wanted students to understand what the app enables before worrying about digital setup, physical build steps, or character import. The app still needs creative freedom, but freedom should arrive after a concrete, working project baseline.

## Decision

MotionSmith should begin classroom use with a small set of project themes that create real editable projects. The first decision should answer:

> What do you want to make move?

The answer should be a visible result, not a technical process. Examples:

- `Make an arm wave`
- `Make legs walk`
- `Make a head bob`
- `Make a sign spin`
- `Start with my character`

Each guided option must create real `ProjectState` data: character parts, joints, paths, anchors, optional mechanism, fabrication metadata, and reset baseline. No guided entry may be a screenshot, mock tutorial, fake recommendation, or canned animation.

## Agent review synthesis

- `designer`: keep the editor shell compact; do not turn Getting Started into a full-screen tutorial. Use a two-level hierarchy: a clear guided project path, then secondary free-start/import paths. Land on Character so students can personalize the starter immediately.
- `architect`: reuse `utils/project.ts` lesson baseline/reset seams and derive labels from a shared descriptor catalog. Avoid duplicating lesson labels in serialized project data where an id can derive them.
- `planner`: extend the existing lesson and sensemaking seams rather than adding a separate onboarding app. Guided entry must flow into Foundry, Blueprint, and Assembly from the same canonical project state.

## Entry hierarchy

### 1. Splash

Job: brand/loading only.

- Show MotionSmith mark, version, and loading state.
- Auto-dismiss into the editor shell.
- No tutorial text, no videos, no template cards, no persistence choice.

### 2. Getting Started modal

Job: choose the entry path without overwhelming the user.

Primary route:

- `Pick a guided project` opens the project/theme library.

Secondary routes:

- `Starter rig` creates the ideal starter humanoid with no mechanism.
- `Girl` and `Boy` use built-in image starters.
- `Image` imports user art through browser-local processing.
- `Character file` imports a portable character package.
- `Open full project` imports a full local project snapshot.

Rules:

- The modal remains compact and result-first.
- The modal should not show a full lesson gallery if that makes the first screen crowded.
- No required upload: every classroom path must work with built-in starters.
- Image/package/project import stays available, but it does not compete with the guided path.

### 3. Guided project library

Job: show classroom-ready themes and their physical outcome.

The library may live in the left pane, a small shell modal, or a File menu entry. It must not take over the center workbench. Each card uses one visible result and one physical cue.

Minimum project cards:

| Theme card | Digital action -> physical artifact | Starter data |
| --- | --- | --- |
| `Make an arm wave` | Draw/fit a wrist path -> four-bar swings an arm | starter humanoid, right hand path, four-bar baseline |
| `Make legs walk` | Pair foot paths -> linked leg motion | starter humanoid, leg paths, paired mechanism metadata |
| `Make a head bob` | Tune lift path -> cam follower lifts head | starter humanoid, head path, cam baseline |
| `Make a sign spin` | Pick gears -> gear train transfers rotation | sign/prop starter, gear train baseline |
| `Start with my character` | Import or blank rig -> editable parts and joints | blank starter or user package, no hidden mechanism |

Card copy policy:

- One result label.
- One build cue.
- One action.
- No process explanation.
- No internal ids in default view.

Examples:

- `Arm wave` / `four-bar` / `Open`
- `Head bob` / `cam` / `Open`
- `Your character` / `rig first` / `Start`

## Ownership model

Guidance should not make the project feel like a locked demo. Every guided baseline must become editable immediately.

Ownership sequence:

1. Open a guided project.
2. Land on Character with the actual starter selected.
3. Show one `Make it yours` action cluster in the left pane.
4. Let the student adjust body parts, joints, anchors, and artwork surfaces.
5. Let the student redraw the path or edit path points.
6. Let the student swap or refit the mechanism.
7. Preserve compatible mechanisms when replacing the character only when anchors still match; otherwise show `Fit again` or `Reset lesson`.

A satisfying starter humanoid is required. Students should not need to upload an image to experience a complete humanoid workflow. The starter humanoid should include upper/lower arms, hands, upper/lower legs, feet, torso, head, editable joints, editable contours, and fabrication-ready part outlines.

## Physical/digital bridge

Teachers asked for a no-brain connection between what students do on screen and what they can build. Each guided entry must expose the connection across the workflow without paragraphs.

Required bridge by stage:

| Stage | Default bridge |
| --- | --- |
| Character | selected body part -> cut part with joint holes |
| Path | drawn path -> desired end-effector motion |
| Foundry | mechanism choice -> physical motion converter |
| Design | fit/attach -> output link drives selected anchor |
| Blueprint | recipe -> printable or kit-ready build files |
| Assembly | z-stack and board coordinate -> step-by-step build |

The bridge should be visible as chips, icons, handles, short labels, and animation. Longer explanation belongs in optional details or teacher-pack notes, not the center workbench.

## Tutorial policy

Guided instruction is not a separate tutorial mode. It is a thin layer over real controls.

Allowed:

- one left-pane next action;
- one status-bar blocker/recovery chip;
- one canvas micro-hint while manipulating;
- optional 15-90 second local clip slot or external link slot;
- optional one-tap formative check in teacher-pack mode.

Forbidden:

- No full-screen tutorial.
- No center-canvas lesson cards.
- No separate tutorial state store.
- No fake scene, fake project, fake AI result, or fake export.
- No backend, auth, roster, analytics, cloud DB, teacher dashboard.
- No mandatory YouTube, mandatory upload, or required network dependency.

## Shared data model plan

Use one shared descriptor seam so guided entry cannot drift across UI, reset, sensemaking, Blueprint, and Assembly.

Recommended descriptor:

```ts
type GuidedEntryDescriptor = {
  id: string;
  kind: 'lesson' | 'starter' | 'import';
  label: string;
  outcome: string;
  buildCue: string;
  startStage: AppStage;
  recommendedMechanismType?: MechanismConfig['type'];
  createProject?: () => ProjectState;
  resettable: boolean;
};
```

Implementation notes:

- Start inside `utils/project.ts` while the catalog is small.
- Extract to `utils/guidedEntries.ts` only when multiple stages need the catalog directly.
- Persist ids in `ProjectState.metadata`; derive visible labels from the descriptor catalog.
- Keep reset baselines serializable and deterministic.
- Do not create a second tutorial or template state store.

## Implementation phases

### Phase 0 — Contract lock

- Register this plan in the docs maps.
- Add contract assertions for guided-primary / exploration-secondary entry.
- Update `AGENTS.md` to state that classroom entry is theme-guided first while the workbench remains tinkerable.

Done when docs/tests prevent future agents from hiding guided entry or replacing it with a reading-heavy tutorial.

### Phase 1 — Descriptor catalog

- Consolidate starter and lesson metadata behind a shared descriptor contract.
- Keep current factories for `Starter rig`, `Girl`, `Boy`, `Image`, `Character file`, and `Open full project`.
- Add lesson descriptors for the minimum project cards.
- Stop duplicating labels in new serialized project data where ids are enough.

Done when adding a new guided project requires one descriptor plus one project factory, not scattered UI edits.

### Phase 2 — Guided project entry surface

- Add a prominent `Pick a guided project` route from Getting Started or Character left pane.
- Keep the first modal compact; use a secondary library surface for theme cards if needed.
- Land every guided project on Character.
- Show `Make it yours` as the first left-pane action after load.

Done when a novice can start a guided theme in one to two clicks and still bypass it for open exploration.

### Phase 3 — Starter humanoid quality gate

- Ensure the default starter humanoid is a full editable humanoid, not a weak placeholder.
- Require upper/lower limb parts, hands/feet, joints, anchors, contours, and fabrication outlines.
- Keep blank starters mechanism-free.
- Ensure built-in Girl/Boy templates remain compact choices, not large hero content.

Done when the starter humanoid can support Character -> Path -> Foundry -> Blueprint -> Assembly without any upload.

### Phase 4 — Physical/digital bridge cues

- Add one build cue per guided card.
- Reuse mechanism sensemaking metadata in Foundry, Design, Blueprint, and Assembly.
- Keep cues short and visible before optional details.
- Ensure every failure says object + cause -> action.

Done when teachers can point to the screen and identify what digital action creates which physical artifact.

### Phase 5 — End-to-end classroom QA

- Browser flow: splash -> guided project -> Character -> Path edit -> Foundry/Design -> Blueprint -> Assembly.
- Browser flow: skip guided entry -> blank/import project -> same downstream tools.
- Contract checks: no server/cloud/auth/dashboard language; no fake project state; reset restores baselines.
- Verify production preview at `/ms/` remains static and local-first.

Done when guided and free paths both produce the same kind of buildable, exportable `ProjectState`.

## Implementation snapshot — 2026-07-02

Completed first production slice:

- Getting Started now presents a compact primary guided route, then opens a secondary project library instead of crowding the first modal.
- `Waving arm` creates real editable lesson state through `createLessonProject`, lands on Character, preserves reset baseline behavior, and carries outcome/build-cue/sensemaking metadata.
- Minimum guided cards now create real editable state: arm wave/four-bar, head bob/cam, foot step/five-bar, gear spin/gear pair, and my-character/blank humanoid starter.
- `Start with my character` creates a real blank humanoid starter from the guided library with editable parts and joints, no hidden mechanism, and no upload requirement.
- Starter/import routes remain available as secondary entry points: starter rig, Girl, Boy, Image, Character file, and full project import.
- Browser coverage verifies guided project open -> Character -> Foundry sensemaking without fake project data.

Remaining expansion:

- Add future classroom theme factories only when each creates real editable state.
- Add teacher clip/check assets as optional local/generated enrichment, not required network media.

## Acceptance criteria

- Guided theme entry is primary for classroom use; open exploration is secondary but always available.
- Every guided project creates real editable `ProjectState` data.
- No required upload exists for a complete humanoid workflow.
- The starter humanoid is good enough to personalize, animate, fabricate, and assemble.
- The physical/digital bridge is visible at each workflow stage.
- The center workbench stays a canvas/viewport, not a tutorial or reading panel.
- Blueprint owns build files; Assembly owns animated build steps.
- Reset lesson restores a known-good baseline while preserving app settings.
- All runtime UI copy remains English-only and compact.
- Server, account, cloud, dashboard, analytics, roster, and hosted inference scope remain excluded.

## Stop condition

This plan is implemented when a teacher can open MotionSmith, choose a project theme, hand it to students, and students can personalize the starter, understand the digital-to-physical connection, export a buildable blueprint, and follow animated assembly without needing an upload, account, server, or long instructions.
