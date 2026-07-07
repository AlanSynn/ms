# Reproducing This UI Audit

## Commands run

```bash
# Create output folders
mkdir -p ui-to-web/inventory ui-to-web/screenshots ui-to-web/tools

# Scan Qt presentation source for classes/control text
python3 ui-to-web/tools/extract_qt_ui_inventory.py

# Capture screenshots in headless/offscreen Qt mode
QT_QPA_PLATFORM=offscreen uv run python ui-to-web/tools/capture_ui_screenshots.py

# Extra recommendation-dialog empty-state capture
QT_QPA_PLATFORM=offscreen uv run python /tmp/capture_recommendation_empty.py
```

## Verification performed

```bash
file ui-to-web/screenshots/*.png
find ui-to-web -maxdepth 3 -type f | sort
```

Capture script avoid open camera dialog. Start camera worker, require hardware/permission side effects.