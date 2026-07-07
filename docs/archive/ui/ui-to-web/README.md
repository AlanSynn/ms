# Automataii UI → Web Porting Bundle

This dir = UI doc bundle for rebuild current PyQt6 UI as web/canvas app.

## Included artifacts

| File/folder | Contents |
| --- | --- |
| `UI_TO_WEB_PORT_SPEC.md` | Main window, tabs, menus, buttons, dialogs, status flow, web component mapping |
| `CANVAS_LAYER_STRATEGY.md` | Web design keep one canvas, change only layer visibility across tabs |
| `SCREENSHOT_INDEX.md` | Captured UI screenshot list, source + purpose |
| `inventory/qt_ui_inventory.md` | Auto-scan results for `src/automataii/presentation/qt/**/*.py`: UI classes + text/control calls |
| `inventory/qt_ui_inventory.json` | Machine-readable JSON for same inventory |
| `inventory/source-files.md` | Index of UI-related Python files |
| `screenshots/*.png` | Offscreen Qt runtime captures |
| `tools/capture_ui_screenshots.py` | Screenshot regeneration script |

## Regeneration

```bash
QT_QPA_PLATFORM=offscreen uv run python ui-to-web/tools/capture_ui_screenshots.py
python3 ui-to-web/tools/extract_qt_ui_inventory.py  # auto-inventory script used for this documentation bundle
```

> Note: `inventory/qt_ui_inventory.json` scanned 226 Qt presentation Python files, recorded 193 UI-ish classes + 730 UI calls. Some non-widget QObject/service classes may appear because import PyQt, so prefer curated tables in `UI_TO_WEB_PORT_SPEC.md` when porting.

## Web rebuild direction

Qt app split hard into separate `QGraphicsView/QGraphicsScene` surfaces per tab. On web, **single persistent canvas scene** safer: tabs change side/top tools + layer visibility presets only.

Core layers:

1. sheet/grid/background
2. source image / character parts
3. skeleton bones/joints
4. motion path draw/edit
5. mechanism instances
6. parametric handles/temporary overlays
7. foundry preview/blueprint/fabrication overlays
8. debug/status overlays

See `CANVAS_LAYER_STRATEGY.md` for detailed design.