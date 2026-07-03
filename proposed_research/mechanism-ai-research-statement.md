# Research Statement: Verified Motion-to-Mechanism Synthesis for MotionSmith

Status: proposed research direction  
Last checked: 2026-07-01  
Primary venue mode: HCI/UIST with graphics/mechanical-design evidence  
Product boundary: local-first browser/Tauri MotionSmith; offline Python/build123d may be used for research and teacher-pack generation, but the classroom product must not require cloud/server inference.

## Abstract

MotionSmith needs a reliable way to turn novice-created character motion into real buildable mechanisms. Prior work shows that motion-guided mechanical characters, automata, linkage synthesis, wind-up toys, cable-driven actuation networks, and recent learning-based target-curve-to-mechanism systems are feasible research directions. Separately, text-to-CAD and CAD-as-code systems show that natural language and executable CAD programs can produce editable geometry. The open MotionSmith problem is not text-only CAD generation; it is **verified motion-to-fabricatable mechanism synthesis**: generate or retrieve a small set of candidate mechanisms from a user path or IK trajectory, encode each candidate in a typed mechanism DSL, and accept it only if deterministic kinematics, physics/contact checks, fabrication stack checks, blueprint checks, and assembly-step checks pass.

## Problem statement

Novice makers can draw the motion they want, but they usually cannot choose and parameterize the linkage, gear train, cam, cable route, spacer stack, board holes, and assembly steps needed to build it. MotionSmith currently exposes this difficulty directly: every mechanism must be kept consistent across mechanism semantics, kinematics, 2.5D/3D visualization, force/velocity overlays, fabrication templates, blueprint output, and assembly guide. When those rules drift, the UI can show mechanisms that look plausible but are not physically assembled, not driven by the intended path, or not compatible with the fabrication kit.

The research problem is:

> Given a user-authored 2D/2.5D target motion from paths, IK keyframes, and selected body-part anchors, plus a finite classroom fabrication kit, synthesize or retrieve a small set of editable single-driver mechanism graphs in a typed DSL that approximate the target motion while satisfying explicit kinematic, spatial, material, fabrication, and assembly constraints. Optional text provides intent priors only. Deterministic validators reject or rank candidates, and the accepted DSL compiles to the same browser-local editable preview, blueprint, and assembly artifacts.

This is a motion-first problem. Text can help name intent such as “wave hand” or “step foot,” but it is not the formal specification and must not bypass motion, kinematic, or fabrication validators.


## Ontology and scope

These terms must stay separate throughout the research:

| Term | Meaning in this project | What it does **not** prove |
|---|---|---|
| Text-to-CAD | Natural language to CAD geometry, operations, or executable CAD programs. | Valid mechanism motion, actuation, or assembly. |
| Text-to-mechanism | Natural language to a mechanism concept, topology, constraints, and intent. | That the mechanism realizes a measured path or can be fabricated. |
| Motion-conditioned mechanism synthesis | Target trajectory/keyframes to a kinematic mechanism. | CAD export validity or classroom assembly clarity. |
| Cable-driven actuation | Tension-only cable/tendon routing with anchors, pulleys, springs, friction, and slack constraints. | Equivalent behavior to rigid linkages/gears/cams. |
| Deterministic CAD generation | Repeatable geometry from explicit parameters/specs. | Product implementation or physical performance. |
| Product implementation | A browser-local editor with state, UI, simulation, export, and tests. | Research paper capability unless implemented and verified. |

The repaired framing is: **motion-conditioned mechanism synthesis for fabrication-aware animated mechanisms**. Text prompts and build123d are supporting interfaces; the core object is a physical mechanism whose structure must realize target motion under explicit constraints.

## Evidence-grounded context

### Fact: motion-to-mechanism has strong precedent

Mechanical-character and toy-design work has already shown systems that optimize mechanisms from sketched curves, feature motions, mocap, or requested part motions. Relevant examples include *Computational Design of Mechanical Characters*, *Motion-Guided Mechanical Toy Modeling*, *Designing and Fabricating Mechanical Automata from Mocap Sequences*, *Computational Design of Wind-up Toys*, and *Functionality-aware Retargeting of Mechanisms to 3D Shapes*. These sources justify MotionSmith’s focus on user motion as the primary input.

### Fact: learning-based mechanism synthesis is now plausible

LINKS, LInK, and MechaFormer show that large simulated mechanism corpora, contrastive retrieval, and target-curve-to-DSL sequence generation are credible approaches for mechanism synthesis. They do not remove the need for deterministic validation; they provide candidate generation and initialization.

### Fact: text-to-CAD is adjacent, not sufficient

Text2CAD, DeepCAD, SkexGen, CAD-LLM, CAD-Llama, and FllumaOne show that CAD operations and executable CAD programs can be generated from language or learned representations. These works are relevant to part geometry and CAD-as-code, but they do not by themselves solve mechanism topology, joint constraints, gear pitch, z-clearance, motion coupling, or classroom assembly.

### Fact: cable-driven actuation is a credible alternate branch

Megaro et al. show cable routing for hinged chains and trees driven by target poses/keyframes. This is a useful research branch for character motions that are awkward for planar linkages/gears, but it introduces cable tension, routing, spring, and assembly complexity.

### Inference: MotionSmith’s gap is verified integration

No reviewed source establishes the full MotionSmith stack: novice free-path/IK input, optional text intent, selected character-part binding, 15x15 board/fabrication-kit constraints, local 2.5D/3D preview, physics/contact/friction overlays, blueprint export, and animated assembly guidance in a browser-local workbench. This should be framed as a scoped integration and interaction contribution, not as a claim that motion-to-mechanism itself is new.

## Research questions and hypotheses

| ID | Question / hypothesis | Evidence needed | Risk |
|---|---|---|---|
| RQ1 | Can a typed mechanism DSL represent MotionSmith mechanisms across kinematics, 3D preview, fabrication, blueprint, and assembly without duplicated rules? | DSL schema, sample mechanisms, renderer/export adapters, contract tests. | The DSL may become too broad if it tries to cover every mechanism at once. |
| H1 | Motion-first retrieval/generation plus deterministic optimization will produce more valid beginner candidates than template-only selection. | Benchmarks on target curves/keyframes; path error and fabrication-valid success rate. | Dataset candidates may not map cleanly to MotionSmith kit constraints. |
| H2 | A validation-first pipeline can prevent visually plausible but unbuildable mechanisms. | Fail/pass validators for closure, gear pitch, cam contact, z-clearance, part inventory, and board snapping. | Validators may be too strict early and reject useful approximate designs. |
| H3 | Optional text improves candidate ranking when paired with motion input, but text-only generation is unreliable for physical mechanisms. | Ablation: motion only vs motion + text vs text only. | Text prompts may introduce unsupported mechanisms unless constrained by DSL. |
| H4 | build123d/OpenCascade can improve research artifacts and teacher packs by kernel-validating CAD parts from the same DSL. | STEP/STL/SVG/DXF exports, dimensional checks, manufacturability checks. | Browser product cannot depend on server-side Python; this must remain offline/research-side. |
| H5 | Cable-driven candidates can cover character motions that planar linkages cannot, if routing/tension/assembly are exposed through simple visual handles. | Cable benchmark cases, tension/routing validators, assembly steps. | Cable-driven mechanisms may be too complex for first classroom deployment. |

## Proposed contributions

1. **Fabrication-constrained mechanism DSL**  
   A typed schema for mechanisms, joints, constraints, driver groups, layers, spacers, clips, holes, gears, cams, cables, and board coordinates. The DSL is the single source for simulation, preview, blueprint, and assembly.

2. **Motion-conditioned candidate generator**  
   A retrieval/generative pipeline that accepts a target path or IK sequence and returns candidate DSL programs. Candidate generation can combine template search, LINKS/LInK-style embeddings, MechaFormer-style sequence generation, and optional text intent.

3. **Deterministic validator stack**  
   A hard gate that checks kinematic closure, path matching, gear pitch/radius compatibility, cam/follower contact, slider/guide limits, cable routing/tension, z-layer clearance, spacer stacks, board snapping, part inventory, and export consistency.

4. **Editable tinkerable workbench interaction**  
   Candidate mechanisms appear as editable physical previews with drag handles, path traces, force/velocity overlays, and compact blockers. The user can tune the mechanism without reading a long explanation.

5. **CAD-as-code research/teacher-pack pipeline**  
   A build123d/OpenCascade pipeline that generates kernel-validated parts and assembly artifacts from the same DSL for offline evaluation and teacher packs. Production MotionSmith can still use browser-local Three/Rapier and pre-generated/cached assets.

6. **Benchmark and evaluation suite**  
   A reproducible suite that measures path error, closure residual, gear pitch validity, collision/z-clearance, fabrication success, export validity, runtime, and novice assembly legibility.

## Methodological stance

Use AI only for proposal. Use validators for authority. “Validation” here means deterministic rejection against explicit constraints and sampled tolerances, not a total guarantee of real-world success.

```text
AI candidate: allowed to be creative, approximate, uncertain
DSL parser: must be typed and inspectable
Kinematic solver: must satisfy mechanism equations
Physics/contact layer: must reveal forces, velocity, friction, and collisions
Fabrication validator: must accept/reject the build stack
CAD/export validator: must check dimensions and manufacturable artifacts
UI: must expose only validated candidates or clear blockers
```

## Non-goals

- No cloud-dependent mechanism generation for classroom use.
- No hidden mesh-only mechanism output.
- No text-only “make a waving mechanism” output unless it is converted into a validated motion target and DSL candidate.
- No server CAD export job in the product.
- No claim that the project invents motion-to-mechanism synthesis from scratch.
- No mechanism accepted only because it looks good in a 3D render.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Overclaiming novelty | Frame novelty as integration, validation, browser-local tinkerable workflow, and classroom fabrication constraints. |
| Dataset mismatch | Treat external mechanism datasets as candidate sources; adapt through a kit validator instead of importing blindly. |
| AI hallucinated mechanisms | Require typed DSL parse + deterministic validators before preview/export. |
| CAD-as-code/browser mismatch | Keep DSL canonical; build123d is a research/export sidecar, not a second source of mechanism truth. |
| Too much UI text | Use direct manipulation, icons, traces, blockers, and tooltips; keep research results as internal artifacts. |
| Simulation cost | Use cached traces, batched transforms, instancing, and low-latency validators; run heavy CAD generation offline. |

## Minimum credible validator set

1. **DSL/static validation:** allowed mechanism graph, joint/link incidence, grounded links, driver count, units, coordinate frames, and mobility/DOF sanity.
2. **Kinematic validation:** sampled path/pose error, link length preservation, closure residuals, singularities/toggles, branch flips, velocity/acceleration smoothness, and input range limits.
3. **IK/binding validation:** anchor reachability, body-part joint limits, bend/fold direction consistency, multi-anchor conflicts, and pose error over time.
4. **Fabrication validation:** material thickness, kerf/tolerance, hole and slot clearances, spacer/z-stack collision, gear pitch/tooth compatibility, cam/follower contact, fastener accessibility, and assembly order.
5. **Physics validation:** collision, contact/friction slip, force/torque margins, gravity orientation, and constraint-error thresholds.
6. **Artifact validation:** preview, blueprint, and assembly derive from the same DSL/ProjectState; deterministic export hash; BOM completeness; round-trip project snapshot; and no preview-only parts.

## Success definition

The research direction succeeds when MotionSmith can generate or retrieve at least one validated mechanism candidate for a target motion, show why it passes or fails, let the user tune it directly, and export matching blueprint/assembly artifacts from the same canonical mechanism description.
