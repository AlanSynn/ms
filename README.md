# MotionSmith

MotionSmith is a local-first browser/Tauri workbench for classroom automata projects. Students start from a working character or guided template, draw one visible motion path, fit a buildable mechanism, preview the automata, then export blueprint files and a step-by-step assembly guide.

Live classroom web build: <https://alansynn.com/ms/>

## Classroom flow

1. Open **Getting Started**.
2. Choose **Guide**, **Starter rig**, a built-in image starter, **Image**, or **Character file**.
3. Edit the character or add scene objects in **Character**.
4. Draw a target motion in **Path**.
5. Fit and study a mechanism in **Foundry**.
6. Tune the fitted mechanism instance in **Design**.
7. Generate local build files in **Blueprint**.
8. Assemble from the Three-backed step view in **Assembly**.

MotionSmith remains local-first: no account, cloud save, roster, dashboard, server inference, or server export job is required. Browser autosave, portable project snapshots, ONNX processing, blueprint downloads, and assembly guidance stay on the device. Designated tagged study builds may additionally send pseudonymous interaction records and compact imported source images to the deployment-controlled study collector; deployment profiles can disable all collection or select metrics, replay, or full study capture.

## Current capabilities

- Editable character parts, joints, anchors, outlines, and scene-object images.
- Freehand open or closed motion paths for body parts or scene objects.
- Fabrication-aware mechanism fitting on the default 15 x 15 kit board.
- Foundry-derived mechanism visuals for physical links, holes, pins, gears, cams, spacers, clips, and z-stacks.
- Integrated Design preview where fitted mechanisms drive character or object motion.
- Local blueprint/package exports for prefab-board and custom-part workflows.
- Three-backed Assembly steps for mechanism and character build order.
- Local classroom assessment keys, sensemaking prompts, generated-loop examples, and optional reviewed video slots.

## Development

Prerequisite: Bun 1.3.14 or newer.

```bash
bun install
bun run dev
```

Open the printed Vite URL in a browser.

Study telemetry is excluded from normal builds. Tagged study builds opt in with
one setting: `VITE_STUDY_PROFILE=metrics|replay|study`. See
[`docs/study/README.md`](docs/study/README.md#build-switch).

## Verification

```bash
bun run test:contracts
bun run build
PLAYWRIGHT_WORKERS=2 env -u NO_COLOR PLAYWRIGHT_SERVER=preview playwright test
```

For the full documentation map and active contracts, start with [`docs/README.md`](docs/README.md).

## License

MIT. See [`LICENSE`](LICENSE).
