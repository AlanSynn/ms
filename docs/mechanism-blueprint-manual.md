# Mechanism Blueprint Manual

This manual describes the exported fabrication package produced by MechAnim.

## Package contents

- `*.json`: complete project and fabrication package metadata.
- `*.svg`: printable board-hole layout, character context, and mechanism traces.
- `*-metadata.json`: scene snapshot, validation issues, physical kit settings, and recipe data.
- `*-assembly.html`: browser-printable assembly guide.
- `*-assembly.pdf`: offline assembly handout generated without external services.

## Workflow

1. Load or generate a character package in **Character Selection**.
2. Verify layers, skeleton anchors, and motion paths in **Path Editor**.
3. Sandbox a mechanism in **Mechanism Foundry** or tune an existing one in **Mechanism Design**.
4. Resolve every red validation issue in **Blueprint Export** using the recovery links.
5. Generate the package and download the artifacts needed for fabrication.

## Board coordinates

Board holes use the shared physical-kit transform from `utils/coordinates.ts`. The center of the default 15×15 letter board is `H8`; all export, preview, and validation surfaces use the same grid transform.
