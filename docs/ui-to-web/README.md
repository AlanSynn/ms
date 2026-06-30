# Automataii UI → Web Porting Bundle

This directory is the UI documentation bundle for rebuilding the current PyQt6 UI as a web/canvas app.

## Included artifacts

| File/folder | Contents |
| --- | --- |
| `UI_TO_WEB_PORT_SPEC.md` | Main window, tabs, menus, buttons, dialogs, status flow, and web component mapping |
| `CANVAS_LAYER_STRATEGY.md` | Web design for keeping one canvas while changing only layer visibility across tabs |
| `SCREENSHOT_INDEX.md` | Captured UI screenshot list with source and purpose |
| `inventory/qt_ui_inventory.md` | Auto-scan results for `src/automataii/presentation/qt/**/*.py`: UI classes and text/control calls |
| `inventory/qt_ui_inventory.json` | Machine-readable JSON for the same inventory |
| `inventory/source-files.md` | Index of UI-related Python files |
| `screenshots/*.png` | Offscreen Qt runtime captures |
| `tools/capture_ui_screenshots.py` | Screenshot regeneration script |

## Regeneration

```bash
QT_QPA_PLATFORM=offscreen uv run python ui-to-web/tools/capture_ui_screenshots.py
python3 ui-to-web/tools/extract_qt_ui_inventory.py  # auto-inventory script used for this documentation bundle
```

> Note: `inventory/qt_ui_inventory.json` scanned 226 Qt presentation Python files and recorded 193 UI-ish classes plus 730 UI calls. Some non-widget QObject/service classes may appear because they import PyQt, so prefer the curated tables in `UI_TO_WEB_PORT_SPEC.md` when porting.

## Web rebuild direction

The Qt app is strongly split into separate `QGraphicsView/QGraphicsScene` surfaces per tab. On the web, a **single persistent canvas scene** is safer: tabs change side/top tools and layer visibility presets only.

Core layers:

1. sheet/grid/background
2. source image / character parts
3. skeleton bones/joints
4. motion path draw/edit
5. mechanism instances
6. parametric handles/temporary overlays
7. foundry preview/blueprint/fabrication overlays
8. debug/status overlays

See `CANVAS_LAYER_STRATEGY.md` for the detailed design.
