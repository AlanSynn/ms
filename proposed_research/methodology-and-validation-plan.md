# Methodology and Validation Plan

Status: proposed research loop contract  
Last checked: 2026-07-01  
Recommended lane: `$autoresearch` with prompt-architect-artifact validation, then implementation planning after the artifact is approved.

# Research Mission Contract

## Mission

- **Objective:** Build and validate a research pipeline for AI-assisted, motion-conditioned, fabrication-constrained mechanism synthesis for MotionSmith.
- **Domain / venue mode:** HCI/UIST primary; graphics/mechanical-design and AI/ML evidence secondary.
- **Intended contribution:** A tinkerable browser-local workflow where novice motion input produces editable, validated, fabricatable mechanism candidates with matching preview, blueprint, and assembly artifacts.
- **Non-goals:** No cloud backend, no server inference, no opaque mesh-only mechanisms, no text-only physical mechanism acceptance, no unsupported fabrication claims.

## Hypotheses / Research Questions

| ID | Hypothesis or question | Evidence needed | Artifact | Validator | Risk |
|---|---|---|---|---|---|
| RQ1 | A compact typed semantic mechanism DSL can be the single source for simulation, 3D preview, fabrication, blueprint, and assembly. | DSL examples for 4bar, gear train, cam follower, gear linkage, planetary gear, cable chain. | `mechanism-dsl.schema.json`, sample DSL fixtures. | Fixtures round-trip; mobility/DOF sanity passes; all adapters consume DSL without private topology rules. | DSL may overgrow before patterns stabilize. |
| H1 | Motion-conditioned candidate retrieval/generation beats template-only selection on valid candidate rate. | Benchmarks over free paths, IK traces, and known mechanism targets. | Benchmark table and candidate gallery. | Higher fabrication-valid success rate at equal or lower path error than template baseline. | Dataset mismatch with classroom kit. |
| H2 | Deterministic validators prevent visually plausible but unbuildable output. | Negative cases: off-grid pivots, gear pitch mismatch, z collisions, invalid cam contact, bad cable routing. | Validator test suite. | Every negative fixture fails with a specific compact blocker and no false preview/export artifact is emitted. | False rejections may slow iteration. |
| H3 | Optional text helps ranking but cannot replace motion data. | Ablation comparing motion-only, text-only, and motion+text. | Ablation report. | Motion+text improves top-k ranking; text-only must be labeled exploratory unless a valid target path is inferred. | Text can bias toward unsupported mechanisms. |
| H4 | build123d can generate research-grade CAD/teacher-pack artifacts from the same DSL. | Generated STEP/STL/SVG/DXF for representative mechanisms. | CAD artifact folder and dimension report. | Kernel export succeeds; dimensions match DSL within tolerance. | Python CAD sidecar could drift from browser renderer. |
| H5 | Cable-driven synthesis can expand character-motion coverage beyond planar mechanisms. | Hinged-chain examples where planar linkage fails or is too bulky. | Cable candidate fixtures. | Cable route has valid anchors, no forbidden intersections, bounded tension, and clear assembly steps. | Cables may exceed novice assembly complexity. |

## System architecture

```text
User input
  ├─ selected body part / anchor
  ├─ free path or IK keyframes
  ├─ optional short intent text
  └─ fabrication constraints
       ↓
Target extractor
  ├─ normalize path/keyframes
  ├─ identify endpoint / coupler / driver candidates
  └─ infer allowed mechanism families
       ↓
Candidate generator
  ├─ deterministic templates
  ├─ retrieval from simulated mechanism corpus
  ├─ sequence/DSL generator
  └─ optional text prior for ranking
       ↓
Mechanism DSL
       ↓
Deterministic validators
  ├─ schema/type checks
  ├─ kinematic closure/path error
  ├─ gear/cam/slider/cable constraints
  ├─ z-stack/spacer/clearance checks
  ├─ board/grid/part inventory checks
  ├─ physics/contact/friction checks
  └─ export/assembly checks
       ↓
Editable MotionSmith preview
  ├─ shared 2.5D/3D scene
  ├─ path/force/velocity/friction overlays
  ├─ direct handles and sliders
  ├─ blueprint output
  └─ animated assembly guide
```

## Mechanism DSL sketch

The DSL must be small enough to validate and broad enough to cover current MotionSmith mechanisms.

```ts
type MechanismProgram = {
  id: string;
  family: 'four_bar' | 'gear_train' | 'gear_linkage' | 'cam_follower' | 'planetary_gear' | 'slider_crank' | 'cable_chain';
  board?: { pitchMm: 20; rows: 15; cols: 15; holeDiameterMm: 4 };
  parts: Array<{
    id: string;
    kind: 'link' | 'gear' | 'cam' | 'follower' | 'shaft' | 'spacer' | 'clip' | 'board' | 'cable';
    catalogId?: string;
    material?: 'cardboard' | 'wood' | 'acrylic' | 'hardware' | 'string';
    thicknessMm?: number;
    holes?: Array<{ id: string; xyMm: [number, number]; diameterMm: number }>;
  }>;
  joints: Array<{
    id: string;
    kind: 'revolute' | 'prismatic' | 'pin_slot' | 'gear_mesh' | 'cam_contact' | 'cable_anchor';
    parts: string[];
    xyMm?: [number, number];
    zMm?: number;
    fixedToBoard?: boolean;
  }>;
  constraints: Array<
    | { kind: 'fixed_distance'; a: string; b: string; lengthMm: number }
    | { kind: 'gear_pitch'; a: string; b: string; moduleMm: number; ratio: number }
    | { kind: 'cam_profile_contact'; cam: string; follower: string; guide: string }
    | { kind: 'cable_length'; route: string[]; lengthMm: number; tensionN?: [number, number] }
    | { kind: 'z_clearance'; minMm: number }
  >;
  driver: { jointId: string; kind: 'angle' | 'linear' | 'cable_pull'; phaseRad?: number; speed?: number };
  output: { pointId: string; targetPathId?: string; boundBodyAnchorId?: string };
  assembly: {
    stack: Array<{ partId: string; zOrder: number; role: 'clip' | 'moving' | 'spacer' | 'fixed' | 'shaft' }>;
    steps: Array<{ id: string; action: 'place' | 'insert' | 'clip' | 'test' | 'attach'; partIds: string[] }>;
  };
};
```

## Data plan

1. **Phase 0 — canonical handcrafted corpus**  
   Convert MotionSmith’s mechanism reference into typed DSL fixtures: 4bar, gear train, gear linkage, cam follower, planetary gear, slider/crank variants, and explicitly unsupported mechanisms. This phase establishes truth before AI.

2. **Phase 1 — synthetic valid/invalid corpus**  
   Sample mechanism parameters within fabrication constraints, simulate traces, and label each sample with path features, valid/invalid status, z-clearance, collisions, part counts, and assembly complexity.

3. **Phase 2 — external mechanism datasets**  
   Import only through adapters. For example, LINKS/LInK linkage data can seed candidate retrieval, but each candidate must be remapped to MotionSmith’s board, catalog parts, z-stack, and assembly rules before it is considered valid.

4. **Phase 3 — language annotations**  
   Add short intent labels derived from motion metadata: “wave hand,” “tap foot,” “spin wheel,” “bounce head.” Do not use long procedural descriptions as primary input.

## Model plan

### Baselines

- Template-only selection from current MotionSmith mechanism library.
- Classical optimizer fitting a chosen mechanism family to a target path.
- Retrieval baseline over synthetic DSL corpus using path descriptors.

### Learning candidates

- Contrastive retrieval inspired by LInK: embed target path and mechanism graph/DSL in a shared space.
- Sequence generation inspired by MechaFormer: generate typed DSL tokens from target curve descriptors.
- Optional text embedding only as a prior/reranker.

### Acceptance rule

Text is a ranking/intent prior, not a specification. build123d is an offline CAD validator/generator, not a mechanism solver. A generated model output is never accepted directly. It must:

1. parse as DSL;
2. pass schema validation;
3. simulate without singularities or unresolved constraints;
4. match target motion within tolerance;
5. pass fabrication and export validators;
6. be editable with exposed parameters.

## Solver and validator plan

### Kinematic checks

- Closure residual for linkages.
- Fixed link length invariance.
- Prismatic/slot limits.
- Cam contact and follower travel.
- Gear pitch center distance and ratio.
- Planetary gear relationship and fixed member semantics.
- Cable length/tension and hinge limits.

### Fabrication checks

- Board coordinates snap to 20 mm grid where required.
- Holes fit catalog diameters.
- Moving stacks include correct clips/spacers and no accidental board-as-link substitution.
- Minimum z-clearance is positive for non-contacting parts.
- Gear teeth/pitch and catalog gear sizes match generated geometry.
- Blueprint and assembly labels use readable part names and board row/column callouts.

### Physics checks

- Contact/friction overlays derive from sampled state, not decorative vectors.
- Constraint-error overlays reference actual joint/contact locations.
- Rapier or equivalent physics validation is used only as a validator; kinematic equations remain authoritative for mechanism motion.

## build123d / CAD-as-code plan

Use build123d for offline research and teacher-pack artifact generation:

1. Read canonical DSL fixtures.
2. Generate link plates, gears, cams, spacers, clips, and board references as parametric BREP models.
3. Export STEP/STL for 3D printing and SVG/DXF/PDF-like sheets for laser/craft cutting where supported.
4. Produce dimensional reports: hole center distances, thickness, bounding boxes, gear pitch, and z-stack totals.
5. Compare generated CAD dimensions against browser preview/export dimensions.

This sidecar must not become a hidden production backend. If MotionSmith uses pre-generated assets, cache them locally and keep the DSL as the source of truth.

## Cable-driven research branch

Cable-driven mechanisms should be evaluated separately from planar linkages/gears:

- Input: hinged character chain/tree, desired poses/keyframes, candidate pull location.
- Output: cable route, pulleys/eyelets/anchors, springs, tension bounds, and assembly steps.
- Validators: no forbidden intersections, bounded cable length, clear user-actuation path, no excessive tension, and visibly understandable assembly.
- Initial product stance: research-only until a novice-safe kit representation exists.

## Evaluation metrics

| Metric | Purpose |
|---|---|
| Path RMSE / Chamfer / Hausdorff | Measures output trajectory match. |
| Phase error | Measures timing match along the motion. |
| Closure residual | Verifies kinematic feasibility. |
| Gear pitch residual | Verifies gear mesh compatibility. |
| Cam contact residual | Verifies follower remains in contact. |
| Z-clearance minimum | Detects layer collisions. |
| Part inventory completeness | Ensures all required parts are named and available. |
| Board snap error | Ensures kit compatibility. |
| Export dimension error | Checks blueprint/CAD match. |
| Runtime latency | Keeps browser interaction responsive. |
| Direct-manipulation success | Measures whether users can tune without reading instructions. |
| Assembly step accuracy | Measures whether generated guide matches physical stack order. |

## Initial pass/fail validators

- Every candidate must parse as typed DSL and round-trip without losing mechanism family, joints, driver, output, units, coordinate frame, mobility metadata, and assembly stack.
- Every fixed board pivot must snap to the board grid within 0.25 mm or be marked as a custom-cut part.
- Every generated 4bar must preserve A-B-C-D topology with A/D fixed board pivots, moving B/C joints, one driver, and sane mobility for the declared configuration.
- Every gear train must satisfy center distance = pitch radius sum within tolerance for every meshing pair.
- Every cam follower must identify cam center, follower guide, follower contact point, and valid lift range.
- Every z-stack must have no negative clearance for non-contacting parts; initial tolerance target: at least 0.5 mm clearance.
- Every accepted candidate must export a blueprint/assembly package from the same DSL with deterministic export hash and complete BOM.
- Every browser preview must use the same kinematic sample source as blueprint/assembly previews and must not contain preview-only physical parts.

## Loop Design

### Inner loop

1. Add or import one mechanism family in DSL.
2. Generate or collect target motions for that family.
3. Run template baseline and optimizer.
4. Add retrieval/generative candidate source only after baseline is measured.
5. Run validators.
6. Inspect failures and add the smallest missing constraint or fixture.
7. Produce a candidate gallery with pass/fail reason chips.

### Outer loop

1. After each family, compare validity rate, path error, runtime, and assembly clarity.
2. Decide whether the family belongs in classroom product, research-only, or unsupported backlog.
3. Update problem statement and mechanism taxonomy.
4. Keep claims calibrated to evidence.

## Sandbox and Permissions

- **Allowed files / directories:** `proposed_research/`, future `research/` or `scripts/research/` only after a separate implementation plan, and read-only access to `docs/`, `utils/`, `fabrication/`, and `tests/`.
- **Allowed data / models / APIs:** public papers, public datasets, locally generated synthetic mechanisms, locally cached models. No private classroom/student data without a separate privacy plan.
- **Compute or time limits:** none imposed by tests; long simulations should checkpoint artifacts and run in batches.
- **Credentials / private data boundary:** no credentials required for this research plan. Do not upload user art or classroom data to external services.
- **Destructive operations:** none for research planning artifacts.

## Stop Conditions

- **Success:** The research pack names the problem, cites the core literature, defines a methodology, and provides explicit validators for artifacts and claims.
- **Blocked:** A required source cannot be verified, a dataset license blocks use, or local artifacts cannot be generated without a separate implementation decision.
- **Failure:** The proposed method accepts mechanisms without deterministic validation or requires cloud/server inference for classroom use.
- **Human decision required:** Choosing a target venue, committing to a user study, or adopting a new production dependency beyond existing MotionSmith boundaries.

## OMX Handoff

- **Recommended lane:** `$autoresearch` using `prompt-architect-artifact` validation for the research pack, then `$ralplan` or direct implementation planning for a narrowed prototype.
- **Files created in this pass:** `proposed_research/README.md`, `proposed_research/literature-map.md`, `proposed_research/mechanism-ai-research-statement.md`, `proposed_research/methodology-and-validation-plan.md`, `proposed_research/source-index.json`.
- **Validation evidence required before completion:** citation/source index exists, JSON validates, research statement separates fact/inference/recommendation, methodology has pass/fail validators.

## Immediate Next Actions

1. Prototype the DSL for one family: 4bar with board-fixed A/D, moving B/C, explicit z-stack, and readable assembly.
2. Build a synthetic target-path benchmark for 4bar and gear train.
3. Add a build123d sidecar proof-of-concept that exports one 4bar from the same DSL and compares dimensions against browser/export artifacts.
4. Decide whether cable-driven actuation remains a research branch or becomes a future kit feature after a separate novice-safety review.
