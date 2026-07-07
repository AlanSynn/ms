# UI Screenshot Index

Capture environment: `QT_QPA_PLATFORM=offscreen uv run python ui-to-web/tools/capture_ui_screenshots.py`
Purpose: preserve real Qt runtime layout — tab composition, panel density, button placement, grid/canvas positions — as refs for web rebuild.

| Screenshot | UI state | Main reference points |
| --- | --- | --- |
| ![](screenshots/01-main-tab-character-selection.png) | Character Selection tab | Left input/recognition/view/character/output panels + right ImageProcessingView canvas/grid |
| ![](screenshots/02-main-tab-path-editor.png) | Path Editor tab | Left Parts/Motion Path/Animation/View Controls + right EditorView canvas/grid |
| ![](screenshots/03-main-tab-mechanism-design.png) | Mechanism Design tab | Left mechanism parts/generation/animation/blueprint/view controls + right canvas/grid |
| ![](screenshots/04-main-tab-mechanism-foundry.png) | Mechanism Foundry gallery | GalleryView card-based mechanism selection screen |
| ![](screenshots/90-options-dialog.png) | Options dialog | Appearance/Simulation/Performance/Workflow/Fabrication/Grid settings |
| ![](screenshots/91-processing-steps-group.png) | ProcessingStepsGroup | Detailed processing button group |
| ![](screenshots/92-character-selection-dialog.png) | CharacterSelectionDialog | Preset character selection dialog |
| ![](screenshots/93-manual-segmentation-editor.png) | Manual Segmentation Editor | Part layer radios, skeleton point/layer add/remove, segmentation action buttons |
| ![](screenshots/94-custom-coupler-dialog.png) | Custom Coupler Path dialog | slider + numeric spinbox + OK/Cancel |
| ![](screenshots/95-recommendation-dialog-empty.png) | Recommendation dialog empty state | Recommendation grid, placeholder, Close layout |

Original capture log: [`screenshots/capture-results.md`](screenshots/capture-results.md)