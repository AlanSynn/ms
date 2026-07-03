# Proposed Research: Motion-to-Fabricatable Mechanisms

Status: research planning artifact  
Created: 2026-07-01  
Scope: MotionSmith research direction for AI-assisted, physics-aware, fabrication-valid mechanism generation.

## Why this folder exists

MotionSmith's current manual mechanism rules are expensive to maintain because every mechanism must stay consistent across kinematics, 2.5D/3D rendering, physics overlays, fabrication parts, blueprint output, and assembly steps. This folder collects a research direction for reducing that complexity by combining:

- motion/path-conditioned mechanism synthesis;
- a compact mechanism DSL with hard fabrication validators;
- retrieval/generative AI only where it can be verified;
- deterministic simulation and CAD artifact generation;
- optional build123d/OpenCascade-based CAD-as-code for research and teacher-pack pipelines.

## Artifact map

1. [`literature-map.md`](literature-map.md) — evidence-backed source map across mechanical-character synthesis, linkage/path synthesis, AI CAD, cable-driven actuation, and fabrication-aware systems.
2. [`mechanism-ai-research-statement.md`](mechanism-ai-research-statement.md) — problem statement, research questions, contributions, risks, and scoped novelty.
3. [`methodology-and-validation-plan.md`](methodology-and-validation-plan.md) — concrete research loop, system architecture, model/solver plan, validators, metrics, and stop conditions.
4. [`source-index.json`](source-index.json) — machine-readable citation/source index used by the artifacts.

## High-level conclusion

The evidence does **not** support a text-only mechanism generator as the first credible target. The strongest path is a **motion-first, fabrication-constrained synthesis assistant**:

```text
free path / IK keyframes / selected body part
  + optional short intent text
  + kit/fabrication constraints
  -> candidate mechanism DSL
  -> deterministic kinematic + physics + fabrication validation
  -> editable 2.5D/3D preview, blueprint, and assembly steps
```

The research should use AI as a candidate generator/retriever and use deterministic validators as the authority. Text should guide template choice and constraints, not bypass mechanism physics.

## Product boundary

MotionSmith remains local-first. Production features should not require a backend, cloud model, hosted dashboard, auth, or server-side CAD export. Offline research training and teacher-pack generation can use Python/build123d outside the browser, but shipped classroom workflows must degrade to local templates and cached browser inference.
