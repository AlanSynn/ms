# Mechanism Blueprint Manual

This manual describes the exported fabrication package produced by MotionSmith.

## Package contents

- `*.json`: complete project and fabrication package metadata.
- `*.svg`: printable board-hole layout, character context, and mechanism traces.
- `*-metadata.json`: reduced inspection metadata: project metadata, paths, mechanisms, scene objects, validation issues, physical kit settings, and recipe data. It is not a full round-trip project snapshot; use the main `*.json` package for complete parts, skeleton, settings, and fabrication package data.
- `*-assembly.html`: browser-printable assembly guide.
- `*-assembly.pdf`: offline assembly handout generated without external services.

## Workflow

1. Load, create, or edit a character in **Character**.
2. Verify layers, skeleton anchors, and motion paths in **Path**.
3. Fit a mechanism in **Foundry** or tune an existing instance in **Design**.
4. Resolve every validation issue in **Blueprint** using the recovery links.
5. Generate the package and download the local artifacts needed for fabrication.

## Board coordinates

Board holes use the shared physical-kit transform from `utils/coordinates.ts`. The center of the default 15×15 letter board is `H8`; all export, preview, and validation surfaces use the same grid transform.

## Metadata boundary

The main `*.json` package is the complete local artifact. The `*-metadata.json` file is intentionally smaller so teachers and tests can inspect recipes, paths, mechanisms, scene objects, warnings, and kit settings without loading every character part and skeleton field. Do not use metadata-only files as project import or round-trip truth unless the schema is explicitly expanded.
