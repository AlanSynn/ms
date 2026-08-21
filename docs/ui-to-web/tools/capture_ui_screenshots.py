"""Capture Qt UI screenshots for ui-to-web documentation.

Runs with QT_QPA_PLATFORM=offscreen. The captures are structural UI references,
not complete end-to-end workflow data screenshots.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")

from PyQt6.QtCore import QSize, Qt  # noqa: E402
from PyQt6.QtGui import QImage, QPainter  # noqa: E402
from PyQt6.QtWidgets import QApplication, QDialog, QVBoxLayout  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)


def process(app: QApplication, rounds: int = 8) -> None:
    for _ in range(rounds):
        app.processEvents()
        time.sleep(0.025)


def save_widget(widget, name: str, app: QApplication, size: tuple[int, int] | None = None) -> str:
    if size is not None:
        widget.resize(*size)
    widget.show()
    process(app)
    pixmap = widget.grab()
    path = OUT / f"{name}.png"
    pixmap.save(str(path))
    return str(path.relative_to(Path.cwd())) if path.is_relative_to(Path.cwd()) else str(path)


def placeholder(name: str, title: str, detail: str) -> str:
    image = QImage(QSize(1100, 720), QImage.Format.Format_ARGB32)
    image.fill(0xFFF7F7F7)
    painter = QPainter(image)
    painter.setPen(Qt.GlobalColor.black)
    painter.drawText(32, 54, title)
    y = 96
    for line in detail.splitlines():
        painter.drawText(32, y, line[:160])
        y += 28
    painter.end()
    path = OUT / f"{name}.png"
    image.save(str(path))
    return str(path)


def main() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    results: list[tuple[str, str, str]] = []

    try:
        from automataii.presentation.qt.main_window import AutomataDesigner

        win = AutomataDesigner(debug_mode=False, experiment_mode=False, editing_mode=False)
        win.resize(1440, 920)
        win.show()
        process(app, 12)
        results.append(("main-window-character-selection", save_widget(win, "01-main-character-selection", app), "ok"))

        tab_widget = getattr(win, "tab_widget", None)
        if tab_widget is not None:
            for idx in range(tab_widget.count()):
                tab_widget.setCurrentIndex(idx)
                process(app, 10)
                label = tab_widget.tabText(idx).lower().replace(" ", "-").replace("/", "-")
                path = save_widget(win, f"{idx+1:02d}-main-tab-{label}", app)
                results.append((f"main-tab-{idx}-{tab_widget.tabText(idx)}", path, "ok"))

        # Options is a live widget hosted in a QDialog from the menu.
        try:
            win.show_options_dialog()
            process(app, 6)
            dlg = getattr(win, "_options_dialog", None)
            if dlg is not None:
                results.append(("options-dialog", save_widget(dlg, "90-options-dialog", app, (620, 760)), "ok"))
        except Exception as exc:  # noqa: BLE001
            results.append(("options-dialog", placeholder("90-options-dialog-placeholder", "Options dialog capture failed", repr(exc)), f"failed: {exc!r}"))

    except Exception as exc:  # noqa: BLE001
        results.append(("main-window", placeholder("01-main-window-placeholder", "Main window capture failed", repr(exc)), f"failed: {exc!r}"))

    # Standalone dialogs/widgets that do not require camera or generated models.
    try:
        from automataii.presentation.qt.widgets.processing_steps_group import ProcessingStepsGroup

        dlg = QDialog()
        dlg.setWindowTitle("Processing Steps Group")
        lay = QVBoxLayout(dlg)
        lay.addWidget(ProcessingStepsGroup())
        results.append(("processing-steps-group", save_widget(dlg, "91-processing-steps-group", app, (420, 360)), "ok"))
    except Exception as exc:  # noqa: BLE001
        results.append(("processing-steps-group", placeholder("91-processing-steps-group-placeholder", "ProcessingStepsGroup failed", repr(exc)), f"failed: {exc!r}"))

    try:
        from automataii.presentation.qt.dialogs.character_selection_dialog import (
            CharacterSelectionDialog,
        )

        dlg = CharacterSelectionDialog()
        results.append(("character-selection-dialog", save_widget(dlg, "92-character-selection-dialog", app, (760, 560)), "ok"))
    except Exception as exc:  # noqa: BLE001
        results.append(("character-selection-dialog", placeholder("92-character-selection-dialog-placeholder", "CharacterSelectionDialog failed", repr(exc)), f"failed: {exc!r}"))

    try:
        from automataii.presentation.qt.interactive_segmentation_editor import (
            InteractiveSegmentationEditor,
        )

        image = Path("resources/examples/raw/girl.png")
        if not image.exists():
            image = Path("resources/examples/raw/boy.png")
        dlg = InteractiveSegmentationEditor(str(image), skeleton_data={"joints": []})
        results.append(("manual-segmentation-editor", save_widget(dlg, "93-manual-segmentation-editor", app, (1180, 760)), "ok"))
    except Exception as exc:  # noqa: BLE001
        results.append(("manual-segmentation-editor", placeholder("93-manual-segmentation-editor-placeholder", "Manual segmentation editor failed", repr(exc)), f"failed: {exc!r}"))


    try:
        import json

        from PyQt6.QtGui import QPainterPath

        from automataii.presentation.qt.dialogs.recommendation_dialog import (
            MechanismRecommendationDialog,
        )

        json_path = Path("/tmp/automataii_empty_generated_paths_for_capture.json")
        json_path.write_text(json.dumps([]), encoding="utf-8")
        user_path = QPainterPath()
        user_path.moveTo(0, 0)
        user_path.cubicTo(40, -40, 80, 40, 120, 0)
        user_path.cubicTo(80, -40, 40, 40, 0, 0)
        dlg = MechanismRecommendationDialog(user_path, str(json_path))
        results.append(("recommendation-dialog-empty", save_widget(dlg, "95-recommendation-dialog-empty", app, (1050, 650)), "ok (empty-data state)"))
    except Exception as exc:  # noqa: BLE001
        results.append(("recommendation-dialog-empty", placeholder("95-recommendation-dialog-empty-placeholder", "Recommendation dialog failed", repr(exc)), f"failed: {exc!r}"))

    try:
        from automataii.presentation.qt.tabs.mechanism_foundry.dialogs.custom_coupler_dialog import (
            CustomCouplerPointDialog,
        )

        dlg = CustomCouplerPointDialog(initial_fraction=0.5, coupler_length_mm=120.0)
        results.append(("custom-coupler-dialog", save_widget(dlg, "94-custom-coupler-dialog", app, (460, 240)), "ok"))
    except Exception as exc:  # noqa: BLE001
        results.append(("custom-coupler-dialog", placeholder("94-custom-coupler-dialog-placeholder", "Custom coupler dialog failed", repr(exc)), f"failed: {exc!r}"))

    index = OUT / "capture-results.md"
    lines = ["# Screenshot Capture Results", "", "| UI | File | Status |", "| --- | --- | --- |"]
    for name, path, status in results:
        rel = Path(path)
        try:
            rel_s = str(rel.relative_to(Path.cwd()))
        except Exception:
            rel_s = path
        lines.append(f"| {name} | `{rel_s}` | {status} |")
    index.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
