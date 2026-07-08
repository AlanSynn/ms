#!/usr/bin/env python3
"""Generate fabrication-ready SVG templates for the physical Automataii kit.

The committed ``fabrication/`` package is the default physical board pitch
(20.0 mm).  The generator can also be used with alternate board pitches for
custom output while preserving the profile's bracket/axle hole contract.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import re
import sys
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from typing import cast
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True, slots=True)
class GearPreset:
    key: str
    label: str
    teeth: int


@dataclass(frozen=True, slots=True)
class CamPreset:
    key: str
    label: str
    base_radius_mm: float
    eccentricity_mm: float
    cam_lobes: int
    profile_harmonic: float
    rise_deg: float
    high_dwell_deg: float
    return_deg: float

    def params_mm(self, grid_cell_cm: float) -> dict[str, float]:
        scale = grid_cell_cm / DEFAULT_GRID_CELL_CM
        return {
            "base_radius": self.base_radius_mm * scale,
            "eccentricity": self.eccentricity_mm * scale,
            "cam_lobes": float(self.cam_lobes),
            "profile_harmonic": self.profile_harmonic,
            "rise_deg": self.rise_deg,
            "high_dwell_deg": self.high_dwell_deg,
            "return_deg": self.return_deg,
        }


@dataclass(frozen=True, slots=True)
class FollowerPreset:
    key: str
    label: str
    body_cells: float
    foot_width_cells: float
    guide_slot_travel_cells: float
    output_hole_count: int
    contact_style: str
    roller_axle: bool = False


@dataclass(frozen=True, slots=True)
class PhysicalKitProfile:
    key: str
    default_pitch_mm: float
    hole_diameter_mm: float
    gear_radius_per_tooth_mm: float
    board_rows: int
    board_columns: int
    gear_presets: tuple[GearPreset, ...]
    linkage_length_cells: tuple[int, ...]
    cam_presets: tuple[CamPreset, ...]
    follower_presets: tuple[FollowerPreset, ...]


DEFAULT_GRID_CELL_CM = 2.0
DEFAULT_GRID_PITCH_MM = 20.0
ASSEMBLY_SCHEMA_VERSION = "automataii.fabrication.assembly.v1"
BOARD_COLUMNS = tuple(range(1, 16))
BOARD_ROWS = tuple(chr(ord("A") + index) for index in range(15))
DEFAULT_PHYSICAL_KIT_PROFILE = PhysicalKitProfile(
    key="motionsmith-ms4n",
    default_pitch_mm=DEFAULT_GRID_PITCH_MM,
    hole_diameter_mm=4.0,
    gear_radius_per_tooth_mm=1.25,
    board_rows=len(BOARD_ROWS),
    board_columns=len(BOARD_COLUMNS),
    gear_presets=(
        GearPreset("g8", "G1 / 1-space gear", 8),
        GearPreset("g24", "G3 / 3-space gear", 24),
        GearPreset("g40", "G5 / 5-space gear", 40),
        GearPreset("g56", "G7 / 7-space gear", 56),
    ),
    linkage_length_cells=(2, 4, 6, 8),
    cam_presets=(
        CamPreset("circle", "Circle / steady", 15.0, 0.0, 1, 0.0, 45.0, 270.0, 45.0),
        CamPreset("eccentric", "Eccentric / bounce", 15.0, 5.0, 1, 0.0, 90.0, 60.0, 90.0),
        CamPreset("oval", "Oval / smooth rise", 16.0, 6.0, 2, 0.2, 120.0, 30.0, 120.0),
        CamPreset("pear", "Pear / slow-fast", 18.0, 9.0, 1, 0.35, 150.0, 45.0, 75.0),
    ),
    follower_presets=(
        FollowerPreset("f3-round", "3-cell round-nose follower", 3.0, 0.9, 1.0, 1, "round_nose"),
        FollowerPreset("f4-roller", "4-cell roller-pin follower", 4.0, 0.9, 1.0, 1, "roller_pin", True),
        FollowerPreset("f5-flat", "5-cell flat-shoe follower", 5.0, 1.0, 1.25, 2, "flat_shoe"),
        FollowerPreset("f6-linkage-output", "6-cell linkage-output follower", 6.0, 0.9, 1.5, 3, "linkage_output"),
    ),
)

ProfilePoints = tuple[tuple[float, float], ...]


def grid_step_mm(grid_cell_cm: float) -> float:
    return float(grid_cell_cm) * 10.0


def gear_radius_for_teeth(teeth: int, profile: PhysicalKitProfile) -> float:
    return float(teeth) * profile.gear_radius_per_tooth_mm


def gear_attachment_grid_offsets_mm(
    pitch_radius_mm: float,
    grid_cell_cm: float,
    *,
    profile: PhysicalKitProfile,
) -> tuple[tuple[float, float], ...]:
    pitch_mm = grid_step_mm(grid_cell_cm)
    tooth_depth = profile.gear_radius_per_tooth_mm * (pitch_mm / DEFAULT_GRID_PITCH_MM)
    hole_radius = profile.hole_diameter_mm / 2.0
    root_radius = max(hole_radius + GEAR_ROOT_WEB_MM * (pitch_mm / DEFAULT_GRID_PITCH_MM), pitch_radius_mm - tooth_depth * 1.25)
    usable_radius = root_radius - hole_radius - 4.0
    if usable_radius < pitch_mm:
        return ()
    max_cells = int(usable_radius // pitch_mm)
    offsets: list[tuple[float, float]] = []
    for x_cell in range(-max_cells, max_cells + 1):
        for y_cell in range(-max_cells, max_cells + 1):
            if x_cell == 0 and y_cell == 0:
                continue
            dx = x_cell * pitch_mm
            dy = y_cell * pitch_mm
            if math.hypot(dx, dy) <= usable_radius + 1e-9:
                offsets.append((dx, dy))
    return tuple(sorted(offsets, key=lambda point: (math.hypot(*point), point[1], point[0])))


def build_pear_cam_profile_from_params(
    params: dict[str, float],
    *,
    num_samples: int,
) -> ProfilePoints:
    base_radius = float(params["base_radius"])
    eccentricity = float(params["eccentricity"])
    lobes = max(1, int(float(params["cam_lobes"])))
    harmonic = float(params["profile_harmonic"])
    points: list[tuple[float, float]] = []
    for index in range(num_samples):
        theta = 2.0 * math.pi * index / num_samples
        lobe = (1.0 - math.cos(theta * lobes)) * 0.5
        pear_bias = max(0.0, math.cos(theta - math.pi / 2.0)) ** 2
        harmonic_bias = math.cos(theta * 2.0)
        radius = max(
            base_radius * 0.45,
            base_radius + eccentricity * (0.35 + 0.65 * lobe + 0.2 * pear_bias)
            + base_radius * harmonic * 0.18 * harmonic_bias,
        )
        points.append((radius * math.cos(theta), radius * math.sin(theta)))
    return tuple(points)


def cam_profile_to_drawing_points(profile: ProfilePoints, cx: float, cy: float) -> list[tuple[float, float]]:
    return [(cx + local_y, cy - local_x) for local_x, local_y in profile]


def default_cam_profile_from_svg(key: str) -> ProfilePoints | None:
    """Reuse the committed cam master so regeneration stays byte-stable.

    The browser and fabrication package already treat the committed SVG package
    as the public manufacturing contract.  Keeping those profiles stable avoids
    silent cam drift while still allowing custom-pitch generation to fall back
    to the pure-Python analytic profile above.
    """

    svg_path = ROOT / "fabrication" / "cams" / f"cam-{key}.svg"
    if not svg_path.exists():
        return None
    text = svg_path.read_text(encoding="utf-8")
    view_match = re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', text)
    path_match = re.search(r'<path d="([^"]+)" class="cut cam-outline"', text)
    if view_match is None or path_match is None:
        return None
    width = float(view_match.group(1))
    actual_max_radius = (width - 16.0) / 2.0
    cx = cy = actual_max_radius + 8.0
    values = [float(value) for value in re.findall(r'[-+]?(?:\d+\.\d+|\d+)', path_match.group(1))]
    if len(values) < 6 or len(values) % 2:
        return None
    points = []
    for x_value, y_value in zip(values[0::2], values[1::2], strict=False):
        points.append((cy - y_value, x_value - cx))
    if not points or max(math.hypot(x_value, y_value) for x_value, y_value in points) <= 0:
        return None
    return tuple(points)


def default_cam_max_radius_from_svg(key: str) -> float | None:
    svg_path = ROOT / "fabrication" / "cams" / f"cam-{key}.svg"
    if not svg_path.exists():
        return None
    text = svg_path.read_text(encoding="utf-8")
    view_match = re.search(r'viewBox="0 0 ([0-9.]+) ([0-9.]+)"', text)
    if view_match is None:
        return None
    return (float(view_match.group(1)) - 16.0) / 2.0


def default_cam_attachment_offsets_from_manifest(key: str) -> tuple[tuple[float, float], ...] | None:
    manifest_path = ROOT / "fabrication" / "manifest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    parts = manifest.get("parts")
    cams = parts.get("cams") if isinstance(parts, dict) else None
    if not isinstance(cams, list):
        return None
    for cam in cams:
        if not isinstance(cam, dict) or cam.get("key") != key:
            continue
        offsets = cam.get("attachment_hole_centers_mm")
        if not isinstance(offsets, list):
            return None
        return tuple(
            (float(offset[0]), float(offset[1]))
            for offset in offsets
            if isinstance(offset, list) and len(offset) == 2
        )
    return None


def board_coord_to_svg_xy(coord: str, *, x: float, y: float, size: float) -> tuple[float, float]:
    label = coord.strip().upper()
    row_label = label[:1]
    col_label = label[1:]
    row = BOARD_ROWS.index(row_label) if row_label in BOARD_ROWS else 0
    col_number = int(col_label) if col_label.isdigit() else 1
    col = BOARD_COLUMNS.index(col_number) if col_number in BOARD_COLUMNS else 0
    pitch = size / max(1, len(BOARD_COLUMNS) - 1)
    return x + row * pitch, y + col * pitch


def build_default_assembly_package(
    base_manifest: dict[str, object],
    *,
    profile: PhysicalKitProfile,
) -> dict[str, object]:
    del base_manifest, profile
    recipe_path = ROOT / "fabrication" / "assembly" / "recipes.json"
    if recipe_path.exists():
        return json.loads(recipe_path.read_text(encoding="utf-8"))
    return {
        "schema_version": ASSEMBLY_SCHEMA_VERSION,
        "board": {"rows": list(BOARD_ROWS), "columns": list(BOARD_COLUMNS)},
        "hardware": [],
        "recipes": [],
    }

SCHEMA_VERSION = "automataii.fabrication.v1"
SOURCE_SSOT = "fabrication/generate_fabrication_templates.py"
GENERATED_BY = "fabrication/generate_fabrication_templates.py"
REPRODUCIBLE_GENERATED_AT = "reproducible"
CAM_PROFILE_SAMPLE_COUNT = 144
CAM_PROFILE_SOURCE = "automataii.domain.mechanisms.cam.profile.build_pear_cam_profile_from_params"
FABRICATION_PROFILE_COUNTS = {
    "gear_presets": 4,
    "linkage_length_cells": 4,
    "cam_presets": 4,
    "follower_presets": 4,
}
ATTACHMENT_KINDS = ("linkage", "bracket", "crank", "handle")
ATTACHMENT_KINDS_ATTR = " ".join(ATTACHMENT_KINDS)
CUT = "#ed1c24"
DRILL = "#0071bc"
SCORE = "#777777"
TEXT = "#333333"
ENGRAVE_TEXT = "#008000"
FILL = "#ffffff"
GEAR_ROOT_WEB_MM = 6.0
PRINTABLE_LANDSCAPE_MM = (279.4, 215.9)
PRINTABLE_PORTRAIT_MM = (215.9, 279.4)
COMPLETE_KIT_CUT_SHEET_PATH = "complete-kit-cut-sheet.svg"
COMPLETE_KIT_CUT_SHEET_SIZE_MM = (420.0, 380.0)
COMPLETE_KIT_CUT_SHEET_SIZE_CANDIDATES_MM = (
    COMPLETE_KIT_CUT_SHEET_SIZE_MM,
    (500.0, 420.0),
    (560.0, 460.0),
    (640.0, 500.0),
    (720.0, 560.0),
    (840.0, 640.0),
    (1000.0, 700.0),
)
COMPLETE_KIT_GEAR_COPIES = 2
COMPLETE_KIT_LINKAGE_COPIES = 2
COMPLETE_KIT_SPACER_COPIES = 24
COMPLETE_KIT_INCLUDED_CATEGORIES = ("gears", "linkages", "spacers")
COMPLETE_KIT_EXCLUDED_CATEGORIES = ("ring_gears", "cams", "followers", "brackets", "handles", "cam_modules")


@dataclass(frozen=True, slots=True)
class SvgTemplate:
    """In-memory SVG plus manifest metadata."""

    path: str
    title: str
    desc: str
    width_mm: float
    height_mm: float
    elements: tuple[str, ...]
    metadata: dict[str, object]


@dataclass(frozen=True, slots=True)
class CutSheetPartTemplate:
    part_id: str
    label: str
    elements: tuple[str, ...]
    width_mm: float
    height_mm: float


@dataclass(frozen=True, slots=True)
class CutSheetPlacement:
    part: CutSheetPartTemplate
    x_mm: float
    y_mm: float
    rotated: bool


@dataclass(frozen=True, slots=True)
class GearGeometry:
    pitch_radius_mm: float
    root_radius_mm: float
    outer_radius_mm: float
    attachment_radii_mm: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class FabricationSpec:
    profile: PhysicalKitProfile
    pitch_mm: float
    hole_diameter_mm: float
    hole_radius_mm: float
    hole_diameter_attr: str


@dataclass(frozen=True, slots=True)
class BracketPreset:
    key: str
    label: str
    path: str
    hole_centers_mm: tuple[tuple[float, float], ...]
    outline_points_mm: tuple[tuple[float, float], ...] | None = None


@dataclass(frozen=True, slots=True)
class SpacerPreset:
    key: str
    label: str
    path: str
    outer_diameter_mm: float


@dataclass(frozen=True, slots=True)
class HandlePreset:
    key: str
    label: str
    path: str
    kind: str


@dataclass(frozen=True, slots=True)
class CamModulePreset:
    key: str
    label: str
    path: str
    kind: str


BRACKET_PRESETS: tuple[BracketPreset, ...] = (
    BracketPreset(
        "2-hole-straight",
        "2-hole straight bracket",
        "brackets/bracket-2-hole-straight.svg",
        ((10.0, 10.0), (30.0, 10.0)),
    ),
    BracketPreset(
        "3-hole-straight",
        "3-hole straight bracket",
        "brackets/bracket-3-hole-straight.svg",
        ((10.0, 10.0), (30.0, 10.0), (50.0, 10.0)),
    ),
    BracketPreset(
        "l-3-hole",
        "L 3-hole bracket",
        "brackets/bracket-l-3-hole.svg",
        ((10.0, 10.0), (30.0, 10.0), (10.0, 30.0)),
        ((3.0, 3.0), (37.0, 3.0), (37.0, 17.0), (17.0, 17.0), (17.0, 37.0), (3.0, 37.0)),
    ),
    BracketPreset(
        "triangle-3-hole",
        "Triangle 3-hole bracket",
        "brackets/bracket-triangle-3-hole.svg",
        ((10.0, 10.0), (30.0, 10.0), (10.0, 30.0)),
        ((3.0, 3.0), (39.0, 3.0), (3.0, 39.0)),
    ),
)

SPACER_PRESETS: tuple[SpacerPreset, ...] = (
    SpacerPreset("s10", "S10 spacer", "spacers/spacer-s10.svg", 10.0),
)

HANDLE_PRESETS: tuple[HandlePreset, ...] = (
    HandlePreset(
        "folding-fork-tripod",
        "Triangular paper-tent glue handle",
        "handles/handle-folding-fork-tripod.svg",
        "folding_fork_tripod",
    ),
)

CAM_MODULE_PRESETS: tuple[CamModulePreset, ...] = (
    CamModulePreset("axle-peg", "Axle peg", "cam_modules/axle-peg.svg", "axle"),
    CamModulePreset("crank-handle", "Crank handle", "cam_modules/crank-handle.svg", "handle"),
    CamModulePreset("cam-lock-disk", "Cam lock disk", "cam_modules/cam-lock-disk.svg", "lock"),
    CamModulePreset("paper-washer", "Paper washer", "cam_modules/paper-washer.svg", "washer"),
    CamModulePreset("cam-spacer", "Cam spacer", "cam_modules/cam-spacer.svg", "spacer"),
    CamModulePreset("swappable-cam-disk", "Swappable cam disk", "cam_modules/swappable-cam-disk.svg", "cam"),
    CamModulePreset("u-channel-guide-cartridge", "U-channel guide cartridge", "cam_modules/u-channel-guide-cartridge.svg", "guide"),
    CamModulePreset("gravity-follower-module", "Preassembled gravity follower module", "cam_modules/gravity-follower-module.svg", "follower"),
)


def _fabrication_spec(
    grid_cell_cm: float | None,
    profile: PhysicalKitProfile = DEFAULT_PHYSICAL_KIT_PROFILE,
) -> FabricationSpec:
    _validate_fabrication_profile(profile)
    hole_diameter_mm = float(profile.hole_diameter_mm)
    pitch_mm = (
        float(profile.default_pitch_mm) if grid_cell_cm is None else grid_step_mm(grid_cell_cm)
    )
    return FabricationSpec(
        profile=profile,
        pitch_mm=pitch_mm,
        hole_diameter_mm=hole_diameter_mm,
        hole_radius_mm=hole_diameter_mm / 2.0,
        hole_diameter_attr=_fmt(hole_diameter_mm),
    )


def _validate_fabrication_profile(profile: PhysicalKitProfile) -> None:
    """Fail fast when the fixed workshop-sheet layout cannot represent a profile."""
    if profile.board_rows != len(BOARD_ROWS) or profile.board_columns != len(BOARD_COLUMNS):
        raise ValueError(
            "Fabrication assembly guides are currently fixed to the 15x15 pegboard; "
            f"unsupported profile {profile.key!r}: "
            f"board_rows={profile.board_rows}, board_columns={profile.board_columns}"
        )
    actual_counts = {
        "gear_presets": len(profile.gear_presets),
        "linkage_length_cells": len(profile.linkage_length_cells),
        "cam_presets": len(profile.cam_presets),
        "follower_presets": len(profile.follower_presets),
    }
    mismatches = [
        f"{key}={actual_counts[key]} (expected {expected})"
        for key, expected in FABRICATION_PROFILE_COUNTS.items()
        if actual_counts[key] != expected
    ]
    if mismatches:
        raise ValueError(
            "Fabrication template sheets require exactly four gears, four linkage lengths, "
            "four cams, and four followers; "
            f"unsupported profile {profile.key!r}: {', '.join(mismatches)}"
        )


def _fmt(value: float | int) -> str:
    numeric = float(value)
    if abs(numeric) < 0.0005:
        return "0"
    return f"{numeric:.3f}".rstrip("0").rstrip(".")


def _attrs(**values: object) -> str:
    parts: list[str] = []
    for key, value in values.items():
        attr_name = key.rstrip("_").replace("_", "-")
        parts.append(f'{attr_name}="{escape(str(value))}"')
    return " ".join(parts)


def _data_attrs(**values: object) -> str:
    return " ".join(
        f'data-{key.replace("_", "-")}="{escape(str(value))}"' for key, value in values.items()
    )


def _svg_document(template: SvgTemplate, spec: FabricationSpec) -> str:
    body = "\n".join(template.elements)
    svg_metadata = template.metadata or {}
    root_attributes = {
        "data-profile-key": spec.profile.key,
        "data-grid-pitch-mm": _fmt(spec.pitch_mm),
        "data-hole-diameter-mm": spec.hole_diameter_attr,
    }
    board_role = svg_metadata.get("board_role")
    grid_rows = svg_metadata.get("rows")
    grid_columns = svg_metadata.get("columns")
    if isinstance(board_role, str):
        root_attributes["data-board-role"] = board_role
    if isinstance(grid_rows, int):
        root_attributes["data-grid-rows"] = str(grid_rows)
    if isinstance(grid_columns, int):
        root_attributes["data-grid-columns"] = str(grid_columns)
    style_profile = str(svg_metadata.get("style_profile", "standard"))
    include_cut = style_profile != "board-only"
    cut_style_line = (
        f'      .cut {{ fill: none; stroke: {CUT}; stroke-width: 0.25; stroke-miterlimit: 10; }}\n'
        if include_cut else ""
    )
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="{_fmt(template.width_mm)}mm" height="{_fmt(template.height_mm)}mm"
     viewBox="0 0 {_fmt(template.width_mm)} {_fmt(template.height_mm)}"
     {_attrs(**root_attributes)}>
  <title>{escape(template.title)}</title>
  <desc>{escape(template.desc)}</desc>
  <defs>
    <style>
{cut_style_line}      .drill {{ fill: none; stroke: {DRILL}; stroke-width: 0.2; stroke-miterlimit: 10; }}
      .score {{ fill: none; stroke: {SCORE}; stroke-width: 0.15; stroke-dasharray: 2 1; }}
      .label {{ fill: {TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 4px; }}
      .engrave {{ fill: {ENGRAVE_TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 3.2px; font-weight: bold; }}
      .tiny {{ fill: {TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 3px; }}
      .small {{ fill: {TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 3.6px; }}
      .step-title {{ fill: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 5px; font-weight: bold; }}
      .part-card-label {{ fill: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 3.5px; font-weight: bold; }}
      .coord-label {{ fill: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 6px; font-weight: bold; }}
      .paper {{ fill: {FILL}; stroke: none; }}
    </style>
  </defs>
{body}
</svg>
'''


def _circle(
    cx: float,
    cy: float,
    radius: float,
    class_name: str,
    *,
    extra: dict[str, object] | None = None,
) -> str:
    attrs = _attrs(cx=_fmt(cx), cy=_fmt(cy), r=_fmt(radius), class_=class_name)
    if extra:
        attrs = f"{attrs} {_data_attrs(**extra)}"
    return f"  <circle {attrs}/>"


def _path(
    d: str,
    class_name: str,
    *,
    extra: dict[str, object] | None = None,
    style: str | None = None,
) -> str:
    attrs = _attrs(d=d, class_=class_name)
    if style is not None:
        attrs = f'{attrs} style="{escape(style)}"'
    if extra:
        attrs = f"{attrs} {_data_attrs(**extra)}"
    return f"  <path {attrs}/>"


def _text(
    x: float,
    y: float,
    value: str,
    *,
    class_name: str = "label",
    anchor: str = "middle",
    extra: dict[str, object] | None = None,
) -> str:
    attrs = _attrs(x=_fmt(x), y=_fmt(y), class_=class_name, text_anchor=anchor)
    if extra:
        attrs = f'{attrs} {_data_attrs(**extra)}'
    return f"  <text {attrs}>{escape(value)}</text>"


def _engrave_text(
    x: float,
    y: float,
    value: str,
    *,
    font_size: float | None = None,
    role: str = "part-label",
    data_label: str | None = None,
    transform: str | None = None,
    text_length: float | None = None,
) -> str:
    attrs = _attrs(
        x=_fmt(x),
        y=_fmt(y),
        class_="engrave",
        text_anchor="middle",
        dominant_baseline="middle",
    )
    attrs = f"{attrs} {_data_attrs(engrave_role=role, engrave_label=data_label or value)}"
    if text_length is not None:
        attrs = f'{attrs} textLength="{_fmt(text_length)}" lengthAdjust="spacingAndGlyphs"'
    if font_size is not None:
        attrs = f'{attrs} style="font-size:{_fmt(font_size)}px"'
    if transform is not None:
        attrs = f'{attrs} transform="{escape(transform)}"'
    return f"  <text {attrs}>{escape(value)}</text>"


def _rect(
    x: float,
    y: float,
    width: float,
    height: float,
    class_name: str,
    *,
    extra: dict[str, object] | None = None,
    style: str | None = None,
) -> str:
    attrs = _attrs(
        x=_fmt(x),
        y=_fmt(y),
        width=_fmt(width),
        height=_fmt(height),
        class_=class_name,
    )
    if style is not None:
        attrs = f'{attrs} style="{escape(style)}"'
    if extra:
        attrs = f"{attrs} {_data_attrs(**extra)}"
    return f"  <rect {attrs}/>"


def _rounded_capsule_path(x1: float, y: float, x2: float, radius: float) -> str:
    return (
        f"M {_fmt(x1)} {_fmt(y - radius)} "
        f"L {_fmt(x2)} {_fmt(y - radius)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(x2)} {_fmt(y + radius)} "
        f"L {_fmt(x1)} {_fmt(y + radius)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(x1)} {_fmt(y - radius)} Z"
    )


def _vertical_capsule_path(cx: float, y1: float, y2: float, radius: float) -> str:
    return (
        f"M {_fmt(cx - radius)} {_fmt(y1)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(cx + radius)} {_fmt(y1)} "
        f"L {_fmt(cx + radius)} {_fmt(y2)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(cx - radius)} {_fmt(y2)} "
        f"Z"
    )


def _rounded_rect_path(x: float, y: float, width: float, height: float, radius: float) -> str:
    right = x + width
    bottom = y + height
    radius = min(radius, width / 2.0, height / 2.0)
    return (
        f"M {_fmt(x + radius)} {_fmt(y)} "
        f"L {_fmt(right - radius)} {_fmt(y)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(right)} {_fmt(y + radius)} "
        f"L {_fmt(right)} {_fmt(bottom - radius)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(right - radius)} {_fmt(bottom)} "
        f"L {_fmt(x + radius)} {_fmt(bottom)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(x)} {_fmt(bottom - radius)} "
        f"L {_fmt(x)} {_fmt(y + radius)} "
        f"A {_fmt(radius)} {_fmt(radius)} 0 0 1 {_fmt(x + radius)} {_fmt(y)} Z"
    )


def _polygon_path(points: tuple[tuple[float, float], ...]) -> str:
    first_x, first_y = points[0]
    commands = [f"M {_fmt(first_x)} {_fmt(first_y)}"]
    commands.extend(f"L {_fmt(x)} {_fmt(y)}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


def _translate(element: str, dx: float, dy: float) -> str:
    return f'  <g transform="translate({_fmt(dx)} {_fmt(dy)})">\n{element}\n  </g>'


def _gear_geometry(preset: GearPreset, spec: FabricationSpec) -> GearGeometry:
    pitch_scale = spec.pitch_mm / DEFAULT_GRID_PITCH_MM
    pitch_radius = gear_radius_for_teeth(preset.teeth, profile=spec.profile) * pitch_scale
    tooth_depth = spec.profile.gear_radius_per_tooth_mm * pitch_scale
    root_radius = max(spec.hole_radius_mm + GEAR_ROOT_WEB_MM * pitch_scale, pitch_radius - tooth_depth * 1.25)
    outer_radius = pitch_radius + tooth_depth * 1.2
    max_attachment_radius = root_radius - spec.hole_radius_mm - 4.0
    candidate_radii = (spec.pitch_mm, spec.pitch_mm * 2.0, spec.pitch_mm * 3.0)
    attachment_radii = tuple(r for r in candidate_radii if r <= max_attachment_radius)
    return GearGeometry(
        pitch_radius_mm=pitch_radius,
        root_radius_mm=root_radius,
        outer_radius_mm=outer_radius,
        attachment_radii_mm=attachment_radii,
    )


def _grid_attachment_offsets(max_radius: float, pitch_mm: float) -> tuple[tuple[float, float], ...]:
    """Return board-grid offsets that fit within a circular usable radius."""
    max_cells = max(1, int(max_radius // pitch_mm))
    offsets: list[tuple[float, float]] = []
    clearance_radius = max(0.0, max_radius)
    for x_cell in range(-max_cells, max_cells + 1):
        for y_cell in range(-max_cells, max_cells + 1):
            if x_cell == 0 and y_cell == 0:
                continue
            dx = x_cell * pitch_mm
            dy = y_cell * pitch_mm
            distance = math.hypot(dx, dy)
            if distance <= clearance_radius:
                offsets.append((dx, dy))
    return tuple(sorted(offsets, key=lambda point: (math.hypot(*point), point[1], point[0])))


def _radial_attachment_offsets(radius: float, count: int = 4) -> tuple[tuple[float, float], ...]:
    """Return evenly spaced attachment offsets for parts too small for one board pitch."""
    usable_radius = max(0.0, radius)
    if usable_radius <= 0.0 or count <= 0:
        return ()
    return tuple(
        (
            usable_radius * math.cos(2.0 * math.pi * idx / count),
            usable_radius * math.sin(2.0 * math.pi * idx / count),
        )
        for idx in range(count)
    )


def _gear_attachment_offsets(
    geometry: GearGeometry,
    spec: FabricationSpec,
) -> tuple[tuple[float, float], ...]:
    """Return linkage/bracket/handle holes that remain inside the gear root profile.

    Larger gears use board-grid offsets so brackets and linkages align directly to
    the 20 mm pegboard pitch. The smallest one-space gear intentionally exposes
    only the axle hole; non-grid fallback holes would break board compatibility.
    """
    return cast(
        tuple[tuple[float, float], ...],
        gear_attachment_grid_offsets_mm(
            geometry.pitch_radius_mm,
            spec.pitch_mm / 10.0,
            profile=spec.profile,
        ),
    )


def _attachment_hole_pattern(
    attachment_offsets: tuple[tuple[float, float], ...],
    spec: FabricationSpec,
) -> str:
    if not attachment_offsets:
        return "none"

    def is_grid_value(value: float) -> bool:
        scaled = value / spec.pitch_mm
        return math.isclose(scaled, round(scaled), abs_tol=0.001)

    if all(is_grid_value(dx) and is_grid_value(dy) for dx, dy in attachment_offsets):
        return "grid"
    return "radial"


def _gear_outline_path(
    cx: float, cy: float, teeth: int, root_radius: float, outer_radius: float
) -> str:
    points: list[tuple[float, float]] = []
    for idx in range(teeth * 4):
        theta = 2.0 * math.pi * idx / (teeth * 4)
        radius = outer_radius if idx % 4 in (1, 2) else root_radius
        points.append((cx + radius * math.cos(theta), cy + radius * math.sin(theta)))
    first_x, first_y = points[0]
    commands = [f"M {_fmt(first_x)} {_fmt(first_y)}"]
    commands.extend(f"L {_fmt(x)} {_fmt(y)}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


def _gear_engraving_label(preset: GearPreset) -> str:
    return f"{preset.teeth} Tooth Gear"


def _linkage_engraving_label(cells: int) -> str:
    return f"{cells + 1} Hole Linkage"


def _spacer_engraving_label(_preset: SpacerPreset) -> str:
    return "Spacer"


def _ring_engraving_label(teeth: int) -> str:
    return f"{teeth} Tooth Ring Gear"


def _cam_engraving_label(preset: CamPreset) -> str:
    return f"{preset.key.title()} Cam"


def _follower_engraving_label(preset: FollowerPreset) -> str:
    return {
        "f3-round": "Round Follower",
        "f4-roller": "Roller Follower",
        "f5-flat": "Flat Follower",
        "f6-linkage-output": "Linkage Follower",
    }[preset.key]


def _bracket_engraving_label(preset: BracketPreset) -> str:
    return {
        "2-hole-straight": "2 Hole Bracket",
        "3-hole-straight": "3 Hole Bracket",
        "l-3-hole": "L Bracket",
        "triangle-3-hole": "Triangle Bracket",
    }[preset.key]


def _handle_engraving_label(_preset: HandlePreset) -> str:
    return "Paper Tent Handle"


def _gear_elements(
    preset: GearPreset, spec: FabricationSpec, *, label: bool = True
) -> tuple[list[str], dict[str, object]]:
    geometry = _gear_geometry(preset, spec)
    board_space_diameter = geometry.pitch_radius_mm * 2.0 / spec.pitch_mm
    margin = 8.0
    cx = geometry.outer_radius_mm + margin
    cy = geometry.outer_radius_mm + margin
    attachment_offsets = _gear_attachment_offsets(geometry, spec)
    attachment_pattern = _attachment_hole_pattern(attachment_offsets, spec)
    elements = [
        _path(
            _gear_outline_path(
                cx, cy, preset.teeth, geometry.root_radius_mm, geometry.outer_radius_mm
            ),
            "cut gear-outline",
            extra={
                "teeth": preset.teeth,
                "pitch_radius_mm": _fmt(geometry.pitch_radius_mm),
                "root_radius_mm": _fmt(geometry.root_radius_mm),
                "outer_radius_mm": _fmt(geometry.outer_radius_mm),
                "attachment_hole_pattern": attachment_pattern,
            },
        ),
        _circle(
            cx,
            cy,
            spec.hole_radius_mm,
            "drill axle-hole",
            extra={"hole_role": "axle", "hole_diameter_mm": spec.hole_diameter_attr},
        ),
        _circle(cx, cy, geometry.pitch_radius_mm, "score pitch-circle"),
    ]
    attachment_count = 0
    for dx, dy in attachment_offsets:
        elements.append(
            _circle(
                cx + dx,
                cy + dy,
                spec.hole_radius_mm,
                "drill linkage-hole bracket-hole crank-hole handle-hole",
                extra={
                    "hole_role": "linkage-bracket-crank-handle",
                    "attachment_kinds": ATTACHMENT_KINDS_ATTR,
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": attachment_count,
                    "hole_x_offset_mm": _fmt(dx),
                    "hole_y_offset_mm": _fmt(dy),
                    "hole_radius_mm": _fmt(math.hypot(dx, dy)),
                },
            )
        )
        attachment_count += 1
    if label:
        label_value = _gear_engraving_label(preset)
        if preset.teeth <= 8:
            elements.append(_engrave_text(cx, cy - 4.9, "8 Tooth", font_size=2.7, data_label=label_value))
            elements.append(_engrave_text(cx, cy + 4.9, "Gear", font_size=2.7, data_label=label_value))
        else:
            font_size = 5.0 if preset.teeth <= 24 else 6.0 if preset.teeth <= 40 else 7.0
            elements.append(_engrave_text(cx, cy + 10.0, label_value, font_size=font_size))
    metadata: dict[str, object] = {
        "key": preset.key,
        "teeth": preset.teeth,
        "label": preset.label,
        "engraving_label": _gear_engraving_label(preset),
        "pitch_radius_mm": round(geometry.pitch_radius_mm, 3),
        "outer_radius_mm": round(geometry.outer_radius_mm, 3),
        "root_radius_mm": round(geometry.root_radius_mm, 3),
        "board_space_diameter": round(board_space_diameter, 3),
        "board_space_radius": round(geometry.pitch_radius_mm / spec.pitch_mm, 3),
        "mesh_center_distance_rule": "pitch radii sum; odd board-space pitch diameters mesh on whole board-space centers",
        "hole_diameter_mm": spec.hole_diameter_mm,
        "attachment_hole_count": attachment_count,
        "attachment_hole_pattern": attachment_pattern,
        "attachment_kinds": list(ATTACHMENT_KINDS),
        "attachment_radii_mm": sorted(
            {round(math.hypot(dx, dy), 3) for dx, dy in attachment_offsets}
        ),
        "attachment_hole_centers_mm": [
            [round(dx, 3), round(dy, 3)] for dx, dy in attachment_offsets
        ],
    }
    return elements, metadata


def _gear_template(preset: GearPreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata = _gear_elements(preset, spec)
    geometry = _gear_geometry(preset, spec)
    width = geometry.outer_radius_mm * 2.0 + 16.0
    height = width
    path = f"gears/gear-{preset.teeth}t.svg"
    metadata["path"] = path
    return SvgTemplate(
        path=path,
        title=f"Automataii fabrication gear {preset.label} ({preset.teeth} teeth)",
        desc=(
            f"{preset.label} with {_fmt(spec.hole_diameter_mm)} mm axle. "
            "Attachment holes, when present, sit on the board grid."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _planetary_ring_key(sun: GearPreset, planet: GearPreset) -> str:
    return f"ring-{sun.key}-{planet.key}"


def _planetary_ring_teeth(sun: GearPreset, planet: GearPreset) -> int:
    return int(sun.teeth) + int(planet.teeth) * 2


def _ring_inner_outline_path(
    cx: float,
    cy: float,
    teeth: int,
    tip_radius: float,
    root_radius: float,
) -> str:
    """Return the internal-tooth cut path for a fixed planetary ring gear."""

    points: list[tuple[float, float]] = []
    for idx in range(teeth * 4):
        theta = 2.0 * math.pi * idx / (teeth * 4)
        radius = tip_radius if idx % 4 in (1, 2) else root_radius
        points.append((cx + radius * math.cos(theta), cy + radius * math.sin(theta)))
    return _polygon_path(tuple(points))


def _ring_gear_template(sun: GearPreset, planet: GearPreset, spec: FabricationSpec) -> SvgTemplate:
    ring_teeth = _planetary_ring_teeth(sun, planet)
    pitch_scale = spec.pitch_mm / DEFAULT_GRID_PITCH_MM
    pitch_radius = gear_radius_for_teeth(ring_teeth, profile=spec.profile) * pitch_scale
    tooth_depth = spec.profile.gear_radius_per_tooth_mm * pitch_scale
    tip_radius = max(spec.hole_radius_mm + 12.0, pitch_radius - tooth_depth * 1.15)
    root_radius = pitch_radius + tooth_depth * 0.85
    mount_radius = spec.pitch_mm * 4.0
    outer_radius = max(root_radius + 14.0, mount_radius + spec.hole_radius_mm + 8.0)
    margin = 8.0
    cx = outer_radius + margin
    cy = outer_radius + margin
    mount_offsets = (
        (0.0, -mount_radius),
        (-mount_radius, 0.0),
        (mount_radius, 0.0),
        (0.0, mount_radius),
    )
    key = _planetary_ring_key(sun, planet)
    path = f"ring_gears/{key}.svg"
    elements = [
        _circle(
            cx,
            cy,
            outer_radius,
            "cut ring-outer-outline",
            extra={
                "ring_key": key,
                "outer_radius_mm": _fmt(outer_radius),
                "internal_teeth": ring_teeth,
            },
        ),
        _path(
            _ring_inner_outline_path(cx, cy, ring_teeth, tip_radius, root_radius),
            "cut ring-inner-gear-outline",
            extra={
                "ring_key": key,
                "internal_teeth": ring_teeth,
                "pitch_radius_mm": _fmt(pitch_radius),
                "tip_radius_mm": _fmt(tip_radius),
                "root_radius_mm": _fmt(root_radius),
            },
        ),
        _circle(cx, cy, pitch_radius, "score ring-pitch-circle"),
    ]
    for idx, (dx, dy) in enumerate(mount_offsets):
        elements.append(
            _circle(
                cx + dx,
                cy + dy,
                spec.hole_radius_mm,
                "drill ring-mount-hole bracket-hole",
                extra={
                    "hole_role": "ring-mount",
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": idx,
                    "hole_x_offset_mm": _fmt(dx),
                    "hole_y_offset_mm": _fmt(dy),
                    "mount_radius_mm": _fmt(mount_radius),
                },
            )
        )
    label_radius = (root_radius + outer_radius) / 2.0
    elements.append(
        _engrave_text(
            cx + label_radius / math.sqrt(2.0),
            cy - label_radius / math.sqrt(2.0),
            _ring_engraving_label(ring_teeth),
            font_size=6.2,
            transform=(
                f"rotate(45 {_fmt(cx + label_radius / math.sqrt(2.0))} "
                f"{_fmt(cy - label_radius / math.sqrt(2.0))})"
            ),
        )
    )
    metadata: dict[str, object] = {
        "key": key,
        "teeth": ring_teeth,
        "internal_teeth": ring_teeth,
        "label": f"R{ring_teeth} internal ring gear",
        "engraving_label": _ring_engraving_label(ring_teeth),
        "path": path,
        "compatible_sun_teeth": sun.teeth,
        "compatible_planet_teeth": planet.teeth,
        "pitch_radius_mm": round(pitch_radius, 3),
        "inner_tip_radius_mm": round(tip_radius, 3),
        "inner_root_radius_mm": round(root_radius, 3),
        "outer_radius_mm": round(outer_radius, 3),
        "hole_diameter_mm": spec.hole_diameter_mm,
        "mount_hole_count": len(mount_offsets),
        "mount_radius_mm": round(mount_radius, 3),
        "mount_hole_centers_mm": [[round(dx, 3), round(dy, 3)] for dx, dy in mount_offsets],
    }
    width = outer_radius * 2.0 + margin * 2.0
    height = width
    return SvgTemplate(
        path=path,
        title=f"Automataii fabrication planetary ring gear R{ring_teeth}",
        desc=(
            f"Fixed internal ring gear for G{sun.teeth} sun and G{planet.teeth} planet gears, "
            f"with {_fmt(spec.hole_diameter_mm)} mm board-mount holes."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _linkage_elements(
    cells: int, spec: FabricationSpec, *, label: bool = True
) -> tuple[list[str], dict[str, object]]:
    pitch_mm = spec.pitch_mm
    length = cells * pitch_mm
    width = 14.0
    radius = width / 2.0
    margin = 7.0
    x1 = margin + radius
    x2 = x1 + length
    y = margin + radius
    elements = [
        _path(
            _rounded_capsule_path(x1, y, x2, radius),
            "cut linkage-outline",
            extra={
                "cells": cells,
                "length_mm": _fmt(length),
                "pitch_mm": _fmt(pitch_mm),
                "hole_count": cells + 1,
            },
        )
    ]
    for idx in range(cells + 1):
        elements.append(
            _circle(
                x1 + idx * pitch_mm,
                y,
                spec.hole_radius_mm,
                "drill linkage-hole bracket-hole",
                extra={
                    "hole_role": "linkage-bracket",
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": idx,
                },
            )
        )
    if label:
        label_value = _linkage_engraving_label(cells)
        elements.append(_engrave_text((x1 + x2) / 2.0, y - 4.5, f"{cells + 1} Hole", font_size=3.8, data_label=label_value, text_length=16.5))
        elements.append(_engrave_text((x1 + x2) / 2.0, y + 4.5, "Linkage", font_size=3.8, data_label=label_value, text_length=16.5))
    metadata: dict[str, object] = {
        "key": f"linkage-{cells}-cell",
        "cells": cells,
        "label": f"{cells}-cell linkage",
        "engraving_label": _linkage_engraving_label(cells),
        "length_mm": round(length, 3),
        "pitch_mm": round(pitch_mm, 3),
        "hole_diameter_mm": spec.hole_diameter_mm,
        "hole_count": cells + 1,
    }
    return elements, metadata


def _linkage_template(cells: int, spec: FabricationSpec) -> SvgTemplate:
    pitch_mm = spec.pitch_mm
    elements, metadata = _linkage_elements(cells, spec)
    width = cells * pitch_mm + 28.0
    height = 34.0
    path = f"linkages/linkage-{cells}-cell.svg"
    metadata["path"] = path
    return SvgTemplate(
        path=path,
        title=f"Automataii fabrication linkage {cells} cells",
        desc=(
            f"{cells}-cell linkage bar with {_fmt(spec.hole_diameter_mm)} mm holes at "
            f"{pitch_mm:.1f} mm board-pitch spacing."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _follower_outline_path(
    preset: FollowerPreset,
    cx: float,
    top_y: float,
    body_width: float,
    body_height: float,
    foot_width: float,
    foot_height: float,
) -> str:
    body_radius = body_width / 2.0
    if preset.contact_style == "flat_shoe":
        body_left = cx - body_width / 2.0
        body_right = cx + body_width / 2.0
        foot_left = cx - foot_width / 2.0
        foot_right = cx + foot_width / 2.0
        foot_top = top_y + body_height - foot_height
        bottom = top_y + body_height
        return _polygon_path(
            (
                (body_left, top_y + body_radius),
                (cx, top_y),
                (body_right, top_y + body_radius),
                (body_right, foot_top),
                (foot_right, foot_top),
                (foot_right, bottom),
                (foot_left, bottom),
                (foot_left, foot_top),
                (body_left, foot_top),
            )
        )
    return _vertical_capsule_path(
        cx, top_y + body_radius, top_y + body_height - body_radius, body_radius
    )


def _follower_guide_slot_centers(
    top_y: float,
    body_height: float,
    travel_mm: float,
    hole_diameter_mm: float,
    *,
    roller_axle: bool = False,
) -> tuple[float, ...]:
    half_total_slot = (travel_mm + hole_diameter_mm) / 2.0
    bottom_clearance = 28.0 if roller_axle else 8.0
    return (top_y + body_height - half_total_slot - bottom_clearance,)


def _slot_path(cx: float, cy: float, travel_mm: float, radius: float) -> str:
    return _vertical_capsule_path(cx, cy - travel_mm / 2.0, cy + travel_mm / 2.0, radius)


def _follower_elements(
    preset: FollowerPreset,
    spec: FabricationSpec,
    *,
    label: bool = True,
) -> tuple[list[str], dict[str, object], float, float]:
    pitch_mm = spec.pitch_mm
    scale = pitch_mm / DEFAULT_PHYSICAL_KIT_PROFILE.default_pitch_mm
    body_width = 14.0 * scale
    foot_width = max(body_width, preset.foot_width_cells * pitch_mm)
    foot_height = 10.0 * scale
    body_height = preset.body_cells * pitch_mm
    travel_mm = preset.guide_slot_travel_cells * pitch_mm
    margin = 8.0 * scale
    width = foot_width + margin * 2.0
    height = body_height + margin * 2.0
    cx = width / 2.0
    top_y = margin
    output_y_values = tuple(top_y + pitch_mm * (idx + 1) for idx in range(preset.output_hole_count))
    guide_y_values = _follower_guide_slot_centers(
        top_y,
        body_height,
        travel_mm,
        spec.hole_diameter_mm,
        roller_axle=preset.roller_axle,
    )
    contact_y = top_y + body_height
    contact_kind = "flat" if preset.contact_style == "flat_shoe" else "rounded"
    elements = [
        _path(
            _follower_outline_path(
                preset,
                cx,
                top_y,
                body_width,
                body_height,
                foot_width,
                foot_height,
            ),
            "cut follower-outline",
            extra={
                "follower_key": preset.key,
                "contact_style": preset.contact_style,
                "pitch_mm": _fmt(pitch_mm),
                "guide_slot_travel_mm": _fmt(travel_mm),
            },
        )
    ]
    for idx, y_value in enumerate(output_y_values):
        elements.append(
            _circle(
                cx,
                y_value,
                spec.hole_radius_mm,
                "drill linkage-hole follower-output-hole",
                extra={
                    "hole_role": "linkage-output",
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": idx,
                    "hole_y_mm": _fmt(y_value - top_y),
                },
            )
        )
    for idx, y_value in enumerate(guide_y_values):
        elements.append(
            _path(
                _slot_path(cx, y_value, travel_mm, spec.hole_radius_mm),
                "cut guide-slot follower-guide-slot",
                extra={
                    "slot_role": "guide",
                    "hole_role": "guide-slot",
                    "slot_index": idx,
                    "slot_width_mm": spec.hole_diameter_attr,
                    "slot_travel_mm": _fmt(travel_mm),
                    "slot_center_y_mm": _fmt(y_value - top_y),
                },
            )
        )
    roller_axle_centers: list[list[float]] = []
    if preset.roller_axle:
        roller_y = contact_y - max(12.0 * scale, spec.hole_radius_mm + 7.0)
        elements.append(
            _circle(
                cx,
                roller_y,
                spec.hole_radius_mm,
                "drill roller-axle-hole follower-contact-hole",
                extra={
                    "hole_role": "roller-axle",
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "contact_style": preset.contact_style,
                },
            )
        )
        roller_axle_centers.append([round(0.0, 3), round(roller_y - top_y, 3)])
    if label:
        label_value = _follower_engraving_label(preset)
        elements.append(
            _engrave_text(
                cx - 4.8 * scale,
                top_y + body_height / 2.0,
                label_value,
                font_size=3.0 * scale,
                data_label=label_value,
                text_length=min(body_height - 18.0 * scale, len(label_value) * 3.0 * scale * 1.08),
                transform=(
                    f"rotate(90 {_fmt(cx - 4.8 * scale)} "
                    f"{_fmt(top_y + body_height / 2.0)})"
                ),
            )
        )
    metadata: dict[str, object] = {
        "key": preset.key,
        "label": preset.label,
        "engraving_label": _follower_engraving_label(preset),
        "contact_style": preset.contact_style,
        "contact_kind": contact_kind,
        "pitch_mm": round(pitch_mm, 3),
        "hole_diameter_mm": spec.hole_diameter_mm,
        "guide_slot_count": len(guide_y_values),
        "guide_slot_width_mm": spec.hole_diameter_mm,
        "guide_slot_travel_mm": round(travel_mm, 3),
        "guide_slot_centers_mm": [[0.0, round(y - top_y, 3)] for y in guide_y_values],
        "output_hole_count": len(output_y_values),
        "output_hole_centers_mm": [[0.0, round(y - top_y, 3)] for y in output_y_values],
        "roller_axle": preset.roller_axle,
        "roller_axle_hole_centers_mm": roller_axle_centers,
        "body_width_mm": round(body_width, 3),
        "body_height_mm": round(body_height, 3),
        "foot_width_mm": round(foot_width, 3),
    }
    return elements, metadata, width, height


def _follower_template(preset: FollowerPreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata, width, height = _follower_elements(preset, spec)
    path = f"followers/follower-{preset.key}.svg"
    metadata["path"] = path
    return SvgTemplate(
        path=path,
        title=f"Automataii fabrication follower {preset.key}",
        desc=(
            f"{preset.label} with {_fmt(spec.hole_diameter_mm)} mm output/guide geometry. "
            "Guide slots slide on fixed pegboard pins or bracket hardware."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _bracket_elements(
    preset: BracketPreset, spec: FabricationSpec, *, label: bool = True
) -> tuple[list[str], dict[str, object], float, float]:
    pitch_mm = spec.pitch_mm
    scale = pitch_mm / DEFAULT_PHYSICAL_KIT_PROFILE.default_pitch_mm
    centers = tuple((x * scale, y * scale) for x, y in preset.hole_centers_mm)
    min_center_x = min(x for x, _ in centers)
    max_center_x = max(x for x, _ in centers)
    outline_bounds: tuple[tuple[float, float], ...]
    if preset.outline_points_mm is None:
        y = centers[0][1]
        radius = 7.0 * scale
        outline = _rounded_capsule_path(min_center_x, y, max_center_x, radius)
        outline_bounds = ((min_center_x - radius, y - radius), (max_center_x + radius, y + radius))
    else:
        scaled_outline_points = tuple((x * scale, y * scale) for x, y in preset.outline_points_mm)
        outline = _polygon_path(scaled_outline_points)
        outline_bounds = scaled_outline_points
    elements = [
        _path(
            outline,
            "cut bracket-outline",
            extra={
                "bracket_key": preset.key,
                "pitch_mm": _fmt(pitch_mm),
                "hole_count": len(centers),
            },
        )
    ]
    for idx, (cx, cy) in enumerate(centers):
        elements.append(
            _circle(
                cx,
                cy,
                spec.hole_radius_mm,
                "drill bracket-hole linkage-hole",
                extra={
                    "hole_role": "bracket",
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": idx,
                    "hole_x_mm": _fmt(cx),
                    "hole_y_mm": _fmt(cy),
                },
            )
        )
    max_x = max(
        max(x + spec.hole_radius_mm for x, _ in centers),
        max(x for x, _ in outline_bounds),
    )
    max_y = max(
        max(y + spec.hole_radius_mm for _, y in centers),
        max(y for _, y in outline_bounds),
    )
    width = max(max_x + 4.0, 40.0)
    height = max(max_y + 4.0, 20.0)
    if label:
        label_value = _bracket_engraving_label(preset)
        bracket_label_layout = {
            "2-hole-straight": ((min_center_x + max_center_x) / 2.0, centers[0][1] - 4.2 * scale, 22.0 * scale, 2.4 * scale),
            "3-hole-straight": ((min_center_x + max_center_x) / 2.0, centers[0][1] - 4.2 * scale, 24.0 * scale, 2.4 * scale),
            "l-3-hole": (20.0 * scale, 5.8 * scale, 16.0 * scale, 2.6 * scale),
            "triangle-3-hole": (19.0 * scale, 5.8 * scale, 28.0 * scale, 2.4 * scale),
        }[preset.key]
        label_x, label_y, text_length, font_size = bracket_label_layout
        elements.append(
            _engrave_text(
                label_x,
                label_y,
                label_value,
                font_size=font_size,
                data_label=label_value,
                text_length=text_length,
            )
        )
    metadata: dict[str, object] = {
        "key": preset.key,
        "label": preset.label,
        "engraving_label": _bracket_engraving_label(preset),
        "path": preset.path,
        "pitch_mm": round(pitch_mm, 3),
        "hole_diameter_mm": spec.hole_diameter_mm,
        "hole_count": len(centers),
        "hole_centers_mm": [[round(x, 3), round(y, 3)] for x, y in centers],
    }
    return elements, metadata, width, height


def _bracket_template(preset: BracketPreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata, width, height = _bracket_elements(preset, spec)
    return SvgTemplate(
        path=preset.path,
        title=f"Automataii fabrication bracket {preset.key}",
        desc=(
            f"{preset.label} with {_fmt(spec.hole_diameter_mm)} mm holes on "
            f"{spec.pitch_mm:.1f} mm centers."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _spacer_elements(
    preset: SpacerPreset, spec: FabricationSpec, *, label: bool = True
) -> tuple[list[str], dict[str, object], float, float]:
    outer_radius = preset.outer_diameter_mm / 2.0
    if outer_radius <= spec.hole_radius_mm:
        raise ValueError(
            f"Spacer {preset.key!r} outer diameter must exceed "
            f"{_fmt(spec.hole_diameter_mm)} mm hole diameter"
        )
    margin = 4.0
    cx = outer_radius + margin
    cy = outer_radius + margin
    elements = [
        _circle(
            cx,
            cy,
            outer_radius,
            "cut spacer-outline washer-outline",
            extra={
                "spacer_key": preset.key,
                "outer_diameter_mm": _fmt(preset.outer_diameter_mm),
                "inner_diameter_mm": spec.hole_diameter_attr,
            },
        ),
        _circle(
            cx,
            cy,
            spec.hole_radius_mm,
            "drill spacer-hole axle-hole linkage-hole bracket-hole",
            extra={
                "hole_role": "spacer",
                "hole_diameter_mm": spec.hole_diameter_attr,
                "hole_index": 0,
            },
        ),
    ]
    height = preset.outer_diameter_mm + margin * 2.0
    if label:
        label_x = cx + 3.2
        label_y = cy
        elements.append(
            _engrave_text(
                label_x,
                label_y,
                _spacer_engraving_label(preset),
                font_size=1.6,
                transform=f"rotate(90 {_fmt(label_x)} {_fmt(label_y)})",
            )
        )
    width = preset.outer_diameter_mm + margin * 2.0
    metadata: dict[str, object] = {
        "key": preset.key,
        "label": preset.label,
        "engraving_label": _spacer_engraving_label(preset),
        "path": preset.path,
        "outer_diameter_mm": round(preset.outer_diameter_mm, 3),
        "inner_diameter_mm": spec.hole_diameter_mm,
        "hole_diameter_mm": spec.hole_diameter_mm,
        "hole_count": 1,
        "hole_centers_mm": [[round(cx, 3), round(cy, 3)]],
        "stackable": True,
    }
    return elements, metadata, width, height


def _spacer_template(preset: SpacerPreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata, width, height = _spacer_elements(preset, spec)
    return SvgTemplate(
        path=preset.path,
        title=f"Automataii fabrication spacer {preset.key}",
        desc=(
            f"{preset.label} washer spacer with {_fmt(spec.hole_diameter_mm)} mm center hole "
            "for axle/linkage/bracket clearance stacks."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _handle_folding_fork_tripod_elements(
    preset: HandlePreset, spec: FabricationSpec, *, label: bool
) -> tuple[list[str], dict[str, object], float, float]:
    """Return a simple rectangular paper-tent handle with two visible slit cuts."""

    scale = spec.pitch_mm / DEFAULT_PHYSICAL_KIT_PROFILE.default_pitch_mm
    width = 192.0 * scale
    body_left = 48.0 * scale
    body_right = 176.0 * scale
    seam_right = 188.0 * scale
    y_top = 10.0 * scale
    panel_height = 10.0 * scale
    y_fold_1 = y_top + panel_height
    y_fold_2 = y_fold_1 + panel_height
    y_bottom = y_fold_2 + panel_height
    height = y_bottom + 10.0 * scale
    tab_left = 6.0 * scale
    tab_length = body_left - tab_left
    insert_strip_width = panel_height
    fold_panel_count = 4
    manual_fold_count_per_tab = fold_panel_count - 1
    folded_panel_width = insert_strip_width / fold_panel_count
    handle_grip_length = body_right - body_left
    triangular_prism_side = panel_height
    triangular_prism_height = triangular_prism_side * math.sqrt(3.0) / 2.0
    seam_tab_width = seam_right - body_right
    nominal_cardstock_thickness = 0.5 * scale
    max_material_thickness = (
        math.sqrt(max(0.0, spec.hole_diameter_mm**2 - folded_panel_width**2))
        / fold_panel_count
    )
    folded_tab_diameter = math.hypot(
        folded_panel_width,
        nominal_cardstock_thickness * fold_panel_count,
    )
    recommended_material_thickness = min(0.6 * scale, max_material_thickness)
    split_cut_count = 2
    tab_strips = (
        (y_top, y_fold_1),
        (y_fold_1, y_fold_2),
        (y_fold_2, y_bottom),
    )
    glue_score_rects = tuple(
        (
            tab_left + 2.0 * scale,
            y0 + 2.0 * scale,
            tab_length - 4.0 * scale,
            insert_strip_width - 4.0 * scale,
        )
        for y0, _y1 in tab_strips
    )
    effective_glue_zone_area = sum(
        score_width * score_height for _x, _y, score_width, score_height in glue_score_rects
    )
    double_sided_effective_glue_area = effective_glue_zone_area * 2.0
    glue_foot_area = tab_length * insert_strip_width * len(tab_strips)
    fold_lines = (
        ((body_left, y_fold_1), (seam_right, y_fold_1), "prism-panel-fold"),
        ((body_left, y_fold_2), (seam_right, y_fold_2), "prism-panel-fold"),
        ((body_right, y_top), (body_right, y_bottom), "seam-glue-fold"),
    )
    split_cuts = (
        ((tab_left, y_fold_1), (body_left, y_fold_1), "rectangular-tab-split-cut"),
        ((tab_left, y_fold_2), (body_left, y_fold_2), "rectangular-tab-split-cut"),
    )
    elements = [
        _rect(
            tab_left,
            y_top,
            seam_right - tab_left,
            y_bottom - y_top,
            (
                "cut handle-outline folding-fork-tripod-outline triangular-prism-handle-outline "
                "paper-tent-handle-outline simple-rectangular-slit-handle-outline "
                "no-thin-neck-handle-outline"
            ),
            extra={
                "handle_key": preset.key,
                "handle_kind": preset.kind,
                "hole_diameter_mm": spec.hole_diameter_attr,
                "insert_strip_width_mm": _fmt(insert_strip_width),
                "split_cut_count": split_cut_count,
                "manual_fold_count_per_tab": manual_fold_count_per_tab,
                "folded_panel_width_mm": _fmt(folded_panel_width),
                "folded_rectangular_tab_diameter_mm": _fmt(folded_tab_diameter),
                "max_material_thickness_mm": _fmt(max_material_thickness),
                "triangular_prism_side_mm": _fmt(triangular_prism_side),
            },
        )
    ]
    for idx, (start, end, role) in enumerate(split_cuts):
        elements.append(
            _path(
                f"M {_fmt(start[0])} {_fmt(start[1])} L {_fmt(end[0])} {_fmt(end[1])}",
                "cut tab-split-cut rectangular-tab-split-cut",
                extra={"split_cut_index": idx, "cut_role": role},
            )
        )
    for idx, (start, end, role) in enumerate(fold_lines):
        elements.append(
            _path(
                f"M {_fmt(start[0])} {_fmt(start[1])} L {_fmt(end[0])} {_fmt(end[1])}",
                "score fold-line prism-fold-line",
                extra={"fold_index": idx, "fold_role": role},
            )
        )
    seam_score = (
        body_right + 2.0 * scale,
        y_top + 3.0 * scale,
        seam_tab_width - 4.0 * scale,
        y_bottom - y_top - 6.0 * scale,
    )
    elements.append(
        _rect(
            seam_score[0],
            seam_score[1],
            seam_score[2],
            seam_score[3],
            "score prism-seam-glue-zone handle-glue-zone",
            extra={"glue_zone": "close-triangular-prism-seam"},
        )
    )
    for idx, (x, y, score_width, score_height) in enumerate(glue_score_rects):
        elements.append(
            _rect(
                x,
                y,
                score_width,
                score_height,
                "score glue-foot-score handle-glue-zone rectangular-tab-glue-zone",
                extra={
                    "glue_foot_index": idx,
                    "glue_zone": "after-4mm-hole-pass-through",
                    "score_area_mm2": _fmt(score_width * score_height),
                },
            )
        )
    if label:
        label_value = _handle_engraving_label(preset)
        elements.append(
            _engrave_text(
                (body_left + body_right) / 2.0,
                y_top + panel_height * 1.5,
                label_value,
                font_size=4.0 * scale,
                data_label=label_value,
                text_length=62.0 * scale,
            )
        )
    metadata: dict[str, object] = {
        "key": preset.key,
        "label": preset.label,
        "engraving_label": _handle_engraving_label(preset),
        "path": preset.path,
        "kind": preset.kind,
        "pitch_mm": round(spec.pitch_mm, 3),
        "hole_diameter_mm": spec.hole_diameter_mm,
        "hole_count": 0,
        "insert_tab_count": len(tab_strips),
        "prong_count": 0,
        "split_cut_count": split_cut_count,
        "fold_line_count": len(fold_lines),
        "fold_panel_count": fold_panel_count,
        "manual_fold_count_per_tab": manual_fold_count_per_tab,
        "insert_strip_width_mm": round(insert_strip_width, 3),
        "rectangular_tab_width_mm": round(insert_strip_width, 3),
        "pass_through_tab_width_mm": round(insert_strip_width, 3),
        "pass_through_tab_length_mm": round(tab_length, 3),
        "folded_panel_width_mm": round(folded_panel_width, 3),
        "nominal_cardstock_thickness_mm": round(nominal_cardstock_thickness, 3),
        "recommended_material_thickness_mm": round(recommended_material_thickness, 3),
        "max_material_thickness_mm": round(max_material_thickness, 3),
        "folded_rectangular_tab_diameter_mm": round(folded_tab_diameter, 3),
        "folded_single_bundle_diameter_mm": round(folded_tab_diameter, 3),
        "double_side_fallback": False,
        "glue_foot_count": len(tab_strips),
        "glue_foot_area_mm2": round(glue_foot_area, 3),
        "effective_glue_zone_area_mm2": round(effective_glue_zone_area, 3),
        "double_sided_effective_glue_area_mm2": round(double_sided_effective_glue_area, 3),
        "glue_foot_centers_mm": [
            [round(tab_left + tab_length / 2.0, 3), round((y0 + y1) / 2.0, 3)]
            for y0, y1 in tab_strips
        ],
        "glue_score_rects_mm": [
            [round(x, 3), round(y, 3), round(score_width, 3), round(score_height, 3)]
            for x, y, score_width, score_height in glue_score_rects
        ],
        "handle_grip_length_mm": round(handle_grip_length, 3),
        "grip_width_mm": round(triangular_prism_side, 3),
        "triangular_prism_side_mm": round(triangular_prism_side, 3),
        "triangular_prism_height_mm": round(triangular_prism_height, 3),
        "seam_glue_tab_width_mm": round(seam_tab_width, 3),
        "overall_length_mm": round(width, 3),
        "width_mm": round(width, 3),
        "height_mm": round(height, 3),
        "net_width_mm": round(width, 3),
        "net_height_mm": round(height, 3),
        "attachment_style": "paper_tent_simple_rectangle_slits_fold_to_fit_4mm_then_hot_glue",
        "fabrication_note": (
            "Simple rectangle handle: cut the outer rectangle and the two visible left-side "
            "slits, score the three prism folds on the right, fold each 10 mm tab strip into "
            "four layers so it fits the 4 mm hole, then hot-glue the strips."
        ),
        "sanity_check": {
            "single_replacement_handle": True,
            "simple_rectangle_outline": True,
            "two_visible_split_cuts": split_cut_count == 2,
            "folded_rectangular_tab_fits_4mm_hole": folded_tab_diameter <= spec.hole_diameter_mm,
            "material_thickness_limit_ok": max_material_thickness >= 0.6 - 1e-9,
            "rectangular_insert_tabs": True,
            "no_thin_neck": insert_strip_width >= 10.0 * scale,
            "four_layer_fold_to_fit": fold_panel_count == 4,
            "triangular_prism_net": True,
            "seam_tab_present": seam_tab_width >= 10.0 * scale,
            "effective_glue_zone_area_ok": effective_glue_zone_area >= 600.0 * scale * scale,
            "comfortable_grip_length": handle_grip_length >= spec.pitch_mm * 6.0,
        },
    }
    return elements, metadata, width, height

def _handle_elements(
    preset: HandlePreset, spec: FabricationSpec, *, label: bool = True
) -> tuple[list[str], dict[str, object], float, float]:
    if preset.kind == "folding_fork_tripod":
        return _handle_folding_fork_tripod_elements(preset, spec, label=label)
    raise ValueError(f"Unsupported handle kind: {preset.kind!r}")


def _handle_template(preset: HandlePreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata, width, height = _handle_elements(preset, spec)
    return SvgTemplate(
        path=preset.path,
        title=f"Automataii fabrication handle {preset.key}",
        desc=(
            f"{preset.label}. Cut the simple rectangle and two visible left-side slits, "
            "fold each resulting tab strip into four layers, pass through a "
            f"{_fmt(spec.hole_diameter_mm)} mm hole, then hot-glue."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _cam_module_engraving_label(preset: CamModulePreset) -> str:
    return {
        "axle-peg": "Axle Peg",
        "crank-handle": "Crank Handle",
        "cam-lock-disk": "Cam Lock",
        "paper-washer": "Paper Washer",
        "cam-spacer": "Cam Spacer",
        "swappable-cam-disk": "Cam Disk",
        "u-channel-guide-cartridge": "Guide Cartridge",
        "gravity-follower-module": "Gravity Follower",
    }[preset.key]


def _cam_module_elements(
    preset: CamModulePreset,
    spec: FabricationSpec,
    *,
    label: bool = True,
) -> tuple[list[str], dict[str, object], float, float]:
    scale = spec.pitch_mm / DEFAULT_GRID_PITCH_MM
    hole_centers: list[list[float]] = []
    elements: list[str] = []

    def add_hole(x: float, y: float, role: str) -> None:
        hole_centers.append([round(x, 3), round(y, 3)])
        elements.append(
            _circle(
                x,
                y,
                spec.hole_radius_mm,
                "drill cam-module-hole axle-hole linkage-hole",
                extra={
                    "hole_role": role,
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": len(hole_centers) - 1,
                },
            )
        )

    key = preset.key
    if key == "axle-peg":
        width, height = 70.0 * scale, 18.0 * scale
        elements.append(_path(_rounded_capsule_path(8.0 * scale, height / 2.0, width - 8.0 * scale, 5.0 * scale), "cut cam-module-outline"))
        elements.append(_text(width / 2.0, height / 2.0 + 1.2 * scale, "dowel / rolled paper axle", class_name="tiny"))
    elif key == "crank-handle":
        width, height = 64.0 * scale, 28.0 * scale
        elements.append(_path(_rounded_capsule_path(12.0 * scale, height / 2.0, 52.0 * scale, 7.0 * scale), "cut cam-module-outline"))
        add_hole(14.0 * scale, height / 2.0, "axle")
        add_hole(50.0 * scale, height / 2.0, "hand-grip")
    elif key == "cam-lock-disk":
        width = height = 28.0 * scale
        c = width / 2.0
        elements.append(_circle(c, c, 11.0 * scale, "cut cam-module-outline"))
        elements.append(_path(f"M {_fmt(c - 5.5 * scale)} {_fmt(c)} L {_fmt(c + 5.5 * scale)} {_fmt(c)}", "score lock-slit"))
        elements.append(_path(f"M {_fmt(c)} {_fmt(c - 5.5 * scale)} L {_fmt(c)} {_fmt(c + 5.5 * scale)}", "score lock-slit"))
        add_hole(c, c, "axle-lock")
    elif key == "paper-washer":
        width = height = 22.0 * scale
        c = width / 2.0
        elements.append(_circle(c, c, 8.0 * scale, "cut cam-module-outline washer-outline"))
        add_hole(c, c, "axle-clearance")
    elif key == "cam-spacer":
        width = height = 28.0 * scale
        c = width / 2.0
        elements.append(_circle(c, c, 11.0 * scale, "cut cam-module-outline spacer-outline"))
        add_hole(c, c, "axle-clearance")
    elif key == "swappable-cam-disk":
        width = height = 58.0 * scale
        c = width / 2.0
        points = []
        for index in range(72):
            theta = 2.0 * math.pi * index / 72
            radius_x = 20.0 * scale
            radius_y = 14.0 * scale
            points.append((c + radius_x * math.cos(theta), c + radius_y * math.sin(theta)))
        elements.append(_path(_polygon_path(tuple(points)), "cut cam-module-outline cam-outline"))
        add_hole(c, c, "axle")
        elements.append(_circle(c, c, 20.0 * scale, "score cam-sweep"))
    elif key == "u-channel-guide-cartridge":
        width, height = 54.0 * scale, 104.0 * scale
        elements.append(_path(_rounded_rect_path(4.0 * scale, 4.0 * scale, 46.0 * scale, 94.0 * scale, 6.0 * scale), "cut cam-module-outline guide-cartridge-outline"))
        elements.append(_path(_rounded_rect_path(19.0 * scale, 14.0 * scale, 16.0 * scale, 70.0 * scale, 4.0 * scale), "cut guide-channel"))
        elements.append(_path(f"M {_fmt(14.0 * scale)} {_fmt(14.0 * scale)} L {_fmt(14.0 * scale)} {_fmt(84.0 * scale)}", "score guide-side-rail"))
        elements.append(_path(f"M {_fmt(40.0 * scale)} {_fmt(14.0 * scale)} L {_fmt(40.0 * scale)} {_fmt(84.0 * scale)}", "score guide-side-rail"))
        add_hole(27.0 * scale, 20.0 * scale, "peg-tab")
        add_hole(27.0 * scale, 80.0 * scale, "peg-tab")
    elif key == "gravity-follower-module":
        width, height = 38.0 * scale, 112.0 * scale
        elements.append(_path(_rounded_rect_path(13.0 * scale, 10.0 * scale, 12.0 * scale, 82.0 * scale, 3.0 * scale), "cut follower-rod"))
        elements.append(_path(_rounded_rect_path(8.0 * scale, 10.0 * scale, 22.0 * scale, 24.0 * scale, 3.0 * scale), "score weight-block"))
        elements.append(_path(_rounded_rect_path(6.0 * scale, 88.0 * scale, 26.0 * scale, 16.0 * scale, 8.0 * scale), "cut rounded-follower-head"))
        add_hole(width / 2.0, 16.0 * scale, "output-tab")
    else:
        raise ValueError(f"Unsupported cam module: {preset.kind!r}")

    if label:
        elements.append(_engrave_text(width / 2.0, height - 6.0 * scale, _cam_module_engraving_label(preset), font_size=3.0 * scale))

    metadata: dict[str, object] = {
        "key": preset.key,
        "label": preset.label,
        "engraving_label": _cam_module_engraving_label(preset),
        "path": preset.path,
        "module_kind": preset.kind,
        "hole_diameter_mm": spec.hole_diameter_mm,
        "hole_count": len(hole_centers),
        "hole_centers_mm": hole_centers,
        "contract": "pegboard-mounted-gravity-cam-follower-module",
    }
    return elements, metadata, width, height


def _cam_module_template(preset: CamModulePreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata, width, height = _cam_module_elements(preset, spec)
    return SvgTemplate(
        path=preset.path,
        title=f"Automataii fabrication cam module {preset.key}",
        desc=(
            f"{preset.label} for the pegboard-mounted gravity cam follower module. "
            "The 15x15 pegboard remains the structural base."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )

def _cam_params_for_preset(preset: CamPreset, spec: FabricationSpec) -> dict[str, float]:
    return dict(preset.params_mm(spec.pitch_mm / 10.0))


def _cam_local_profile(preset: CamPreset, spec: FabricationSpec) -> ProfilePoints:
    if math.isclose(spec.pitch_mm, DEFAULT_GRID_PITCH_MM, abs_tol=1e-9):
        committed_profile = default_cam_profile_from_svg(preset.key)
        if committed_profile is not None:
            return committed_profile
    params = _cam_params_for_preset(preset, spec)
    return build_pear_cam_profile_from_params(params, num_samples=CAM_PROFILE_SAMPLE_COUNT)


def _max_profile_radius(profile: ProfilePoints) -> float:
    return max(float(math.hypot(x, y)) for x, y in profile)


def _min_profile_radius(profile: ProfilePoints) -> float:
    return min(float(math.hypot(x, y)) for x, y in profile)


def _profile_radius_at(profile: ProfilePoints, theta: float) -> float:
    """Return nearest sampled local profile radius at ``theta`` radians."""
    best_radius = 0.0
    best_delta = math.inf
    for x, y in profile:
        angle = math.atan2(float(y), float(x))
        delta = abs(math.atan2(math.sin(angle - theta), math.cos(angle - theta)))
        if delta < best_delta:
            best_delta = delta
            best_radius = float(math.hypot(x, y))
    return best_radius


def _drawing_offset_to_local(dx: float, dy: float) -> tuple[float, float]:
    """Invert ``cam_profile_to_drawing_points`` for offset-only fit checks."""
    return -dy, dx


def _cam_attachment_offsets(
    spec: FabricationSpec,
    profile: ProfilePoints,
    max_radius: float,
) -> tuple[tuple[float, float], ...]:
    """Return linkage/bracket/handle holes that fit inside the shared cam profile."""
    minimum_separate_hole_radius = spec.hole_diameter_mm + 2.0
    candidates = _grid_attachment_offsets(max_radius - spec.hole_radius_mm - 4.0, spec.pitch_mm)

    def fits(offset: tuple[float, float], margin: float) -> bool:
        dx, dy = offset
        if math.hypot(dx, dy) < minimum_separate_hole_radius:
            return False
        local_x, local_y = _drawing_offset_to_local(dx, dy)
        theta = math.atan2(local_y, local_x)
        available = max(spec.hole_radius_mm + 1.0, _profile_radius_at(profile, theta))
        return math.hypot(local_x, local_y) + spec.hole_radius_mm + margin <= available

    offsets = tuple(offset for offset in candidates if fits(offset, 4.0))
    if len(offsets) >= 4:
        return offsets
    relaxed = tuple(offset for offset in candidates if fits(offset, 1.0))
    if len(relaxed) >= 4:
        return relaxed
    minimum_pair_distance = spec.hole_diameter_mm + 2.0
    radial_candidates: list[tuple[float, tuple[tuple[float, float], ...], float]] = []
    for radius in (
        max_radius - spec.hole_radius_mm - 4.0,
        spec.pitch_mm * 0.8,
        spec.pitch_mm * 0.7,
        spec.pitch_mm * 0.6,
        spec.pitch_mm * 0.5,
        minimum_separate_hole_radius,
    ):
        if radius < minimum_separate_hole_radius:
            continue
        radial_offsets = tuple(
            offset for offset in _radial_attachment_offsets(radius, 16) if fits(offset, 1.0)
        )
        for candidate in combinations(radial_offsets, 4):
            pair_distances = [
                math.dist(first, second)
                for idx, first in enumerate(candidate)
                for second in candidate[idx + 1 :]
            ]
            min_pair_distance = min(pair_distances)
            if min_pair_distance >= minimum_pair_distance:
                radial_candidates.append((radius, candidate, min_pair_distance))
    if not radial_candidates:
        return ()
    _, selected, _ = max(
        radial_candidates,
        key=lambda item: (item[0], item[2], sum(math.dist((0.0, 0.0), point) for point in item[1])),
    )
    return selected


def _cam_outline_path(points: list[tuple[float, float]]) -> str:
    first_x, first_y = points[0]
    commands = [f"M {_fmt(first_x)} {_fmt(first_y)}"]
    commands.extend(f"L {_fmt(x)} {_fmt(y)}" for x, y in points[1:])
    commands.append("Z")
    return " ".join(commands)


def _cam_elements(
    preset: CamPreset, spec: FabricationSpec, *, label: bool = True
) -> tuple[list[str], dict[str, object], float, float]:
    params = _cam_params_for_preset(preset, spec)
    base_radius = float(params["base_radius"])
    eccentricity = float(params["eccentricity"])
    profile = _cam_local_profile(preset, spec)
    default_max_radius = (
        default_cam_max_radius_from_svg(preset.key)
        if math.isclose(spec.pitch_mm, DEFAULT_GRID_PITCH_MM, abs_tol=1e-9)
        else None
    )
    actual_max_radius = default_max_radius if default_max_radius is not None else _max_profile_radius(profile)
    margin = 8.0
    cx = actual_max_radius + margin
    cy = actual_max_radius + margin
    drawing_points = cam_profile_to_drawing_points(profile, cx, cy)
    outline = _cam_outline_path(drawing_points)
    elements = [
        _path(
            outline,
            "cut cam-outline",
            extra={
                "cam_key": preset.key,
                "base_radius_mm": _fmt(base_radius),
                "eccentricity_mm": _fmt(eccentricity),
                "cam_lobes": int(float(params["cam_lobes"])),
                "profile_harmonic": _fmt(params["profile_harmonic"]),
                "rise_deg": _fmt(params["rise_deg"]),
                "high_dwell_deg": _fmt(params["high_dwell_deg"]),
                "return_deg": _fmt(params["return_deg"]),
                "physical_cam_preset": preset.key,
                "profile_source": CAM_PROFILE_SOURCE,
                "profile_sample_count": CAM_PROFILE_SAMPLE_COUNT,
            },
        ),
        _circle(
            cx,
            cy,
            spec.hole_radius_mm,
            "drill axle-hole",
            extra={"hole_role": "axle", "hole_diameter_mm": spec.hole_diameter_attr},
        ),
        f"  <line {_attrs(x1=_fmt(cx), y1=_fmt(cy), x2=_fmt(cx + base_radius), y2=_fmt(cy), class_='score cam-base-radius')}/>",
        _circle(cx, cy, base_radius, "score cam-base-circle"),
    ]
    attachment_offsets = (
        default_cam_attachment_offsets_from_manifest(preset.key)
        if math.isclose(spec.pitch_mm, DEFAULT_GRID_PITCH_MM, abs_tol=1e-9)
        else None
    )
    if attachment_offsets is None:
        attachment_offsets = _cam_attachment_offsets(spec, profile, actual_max_radius)
    for hole_index, (dx, dy) in enumerate(attachment_offsets):
        elements.append(
            _circle(
                cx + dx,
                cy + dy,
                spec.hole_radius_mm,
                "drill linkage-hole bracket-hole crank-hole handle-hole",
                extra={
                    "hole_role": "linkage-bracket-crank-handle",
                    "attachment_kinds": ATTACHMENT_KINDS_ATTR,
                    "hole_diameter_mm": spec.hole_diameter_attr,
                    "hole_index": hole_index,
                    "hole_x_offset_mm": _fmt(dx),
                    "hole_y_offset_mm": _fmt(dy),
                },
            )
        )
    label_pad = 0.0
    if label:
        label_value = _cam_engraving_label(preset)
        label_font_size = 3.0 if preset.key == "eccentric" else 3.4
        label_y = cy + 4.0 if preset.key == "eccentric" else cy - 4.5
        elements.append(
            _engrave_text(
                cx,
                label_y,
                label_value,
                font_size=label_font_size,
                data_label=label_value,
                text_length=len(label_value) * label_font_size * 0.52,
            )
        )
    metadata: dict[str, object] = {
        "key": preset.key,
        "label": preset.label,
        "engraving_label": _cam_engraving_label(preset),
        "base_radius_mm": round(base_radius, 3),
        "eccentricity_mm": round(eccentricity, 3),
        "cam_lobes": int(float(params["cam_lobes"])),
        "profile_harmonic": round(float(params["profile_harmonic"]), 3),
        "rise_deg": round(float(params["rise_deg"]), 3),
        "high_dwell_deg": round(float(params["high_dwell_deg"]), 3),
        "return_deg": round(float(params["return_deg"]), 3),
        "physical_cam_preset": preset.key,
        "profile_source": CAM_PROFILE_SOURCE,
        "profile_sample_count": CAM_PROFILE_SAMPLE_COUNT,
        "hole_diameter_mm": spec.hole_diameter_mm,
        "attachment_hole_count": len(attachment_offsets),
        "attachment_kinds": list(ATTACHMENT_KINDS),
        "attachment_hole_centers_mm": [
            [round(dx, 3), round(dy, 3)] for dx, dy in attachment_offsets
        ],
    }
    size = actual_max_radius * 2.0 + margin * 2.0
    height = size + label_pad
    return elements, metadata, size, height


def _cam_template(preset: CamPreset, spec: FabricationSpec) -> SvgTemplate:
    elements, metadata, width, height = _cam_elements(preset, spec)
    path = f"cams/cam-{preset.key}.svg"
    metadata["path"] = path
    return SvgTemplate(
        path=path,
        title=f"Automataii fabrication cam {preset.key}",
        desc=(
            f"{preset.label} cam profile with {_fmt(spec.hole_diameter_mm)} mm axle and "
            "linkage/bracket/crank/handle holes."
        ),
        width_mm=width,
        height_mm=height,
        elements=tuple(elements),
        metadata=metadata,
    )


def _sheet_template(
    key: str,
    label: str,
    contains: list[str],
    elements: list[str],
    spec: FabricationSpec,
    *,
    width_mm: float = PRINTABLE_LANDSCAPE_MM[0],
    height_mm: float = PRINTABLE_LANDSCAPE_MM[1],
) -> SvgTemplate:
    title = f"Automataii fabrication sheet {key}: {label}"
    desc = (
        f"Workshop sheet containing: {', '.join(contains)}. "
        f"Nominal holes are {_fmt(spec.hole_diameter_mm)} mm."
    )
    metadata: dict[str, object] = {
        "key": key,
        "label": label,
        "path": f"sheets/{key}.svg",
        "contains": contains,
        "width_mm": width_mm,
        "height_mm": height_mm,
    }
    return SvgTemplate(
        path=f"sheets/{key}.svg",
        title=title,
        desc=desc,
        width_mm=width_mm,
        height_mm=height_mm,
        elements=tuple(elements),
        metadata=metadata,
    )


def _sheet_label(title: str, subtitle: str) -> list[str]:
    return [
        _text(12.0, 12.0, title, class_name="label", anchor="start"),
        _text(12.0, 18.0, subtitle, class_name="tiny", anchor="start"),
    ]


def _complete_cut_part_templates(spec: FabricationSpec) -> tuple[CutSheetPartTemplate, ...]:
    """Return the current classroom complete-kit cut list."""

    parts: list[CutSheetPartTemplate] = []
    for preset in spec.profile.gear_presets:
        elements, _metadata = _gear_elements(preset, spec)
        geometry = _gear_geometry(preset, spec)
        size = geometry.outer_radius_mm * 2.0 + 16.0
        for _ in range(COMPLETE_KIT_GEAR_COPIES):
            parts.append(
                CutSheetPartTemplate(
                    part_id=f"gears:{preset.key}",
                    label=f"G{preset.teeth}",
                    elements=tuple(elements),
                    width_mm=size,
                    height_mm=size,
                )
            )

    for cells in spec.profile.linkage_length_cells:
        elements, _metadata = _linkage_elements(cells, spec)
        for _ in range(COMPLETE_KIT_LINKAGE_COPIES):
            parts.append(
                CutSheetPartTemplate(
                    part_id=f"linkages:linkage-{cells}-cell",
                    label=f"L{cells}",
                    elements=tuple(elements),
                    width_mm=cells * spec.pitch_mm + 28.0,
                    height_mm=28.0,
                )
            )

    for preset in SPACER_PRESETS:
        elements, _metadata, width, height = _spacer_elements(preset, spec)
        for _ in range(COMPLETE_KIT_SPACER_COPIES):
            parts.append(
                CutSheetPartTemplate(
                    part_id=f"spacers:{preset.key}",
                    label=preset.key.upper(),
                    elements=tuple(elements),
                    width_mm=width,
                    height_mm=height,
                )
            )
    return tuple(parts)


def _pack_complete_cut_sheet_parts(
    parts: tuple[CutSheetPartTemplate, ...],
    *,
    width_mm: float,
    height_mm: float,
) -> tuple[CutSheetPlacement, ...]:
    margin = 8.0
    header_height = 18.0
    gap = 3.0
    free_rectangles: list[tuple[float, float, float, float]] = [
        (
            margin,
            margin + header_height,
            width_mm - 2.0 * margin,
            height_mm - 2.0 * margin - header_height,
        )
    ]
    placements: list[CutSheetPlacement] = []
    sorted_parts = sorted(
        parts,
        key=lambda part: (-(part.width_mm * part.height_mm), -max(part.width_mm, part.height_mm)),
    )
    for part in sorted_parts:
        best: tuple[tuple[float, float, int, bool], int, float, float, float, float, bool] | None
        best = None
        for rect_index, (x, y, rect_width, rect_height) in enumerate(free_rectangles):
            for rotated, part_width, part_height in (
                (False, part.width_mm, part.height_mm),
                (True, part.height_mm, part.width_mm),
            ):
                if part_width > rect_width or part_height > rect_height:
                    continue
                score = (
                    min(rect_width - part_width, rect_height - part_height),
                    max(rect_width - part_width, rect_height - part_height),
                    rect_index,
                    rotated,
                )
                if best is None or score < best[0]:
                    best = (score, rect_index, x, y, part_width, part_height, rotated)
        if best is None:
            raise ValueError(
                f"{COMPLETE_KIT_CUT_SHEET_PATH} cannot fit {part.part_id} "
                f"on {_fmt(width_mm)} × {_fmt(height_mm)} mm"
            )

        _score, rect_index, x, y, part_width, part_height, rotated = best
        placements.append(CutSheetPlacement(part=part, x_mm=x, y_mm=y, rotated=rotated))
        _old_x, _old_y, rect_width, rect_height = free_rectangles.pop(rect_index)
        right = (
            x + part_width + gap,
            y,
            rect_width - part_width - gap,
            part_height,
        )
        below = (
            x,
            y + part_height + gap,
            rect_width,
            rect_height - part_height - gap,
        )
        for rect in (right, below):
            if rect[2] > 4.0 and rect[3] > 4.0:
                free_rectangles.append(rect)
        free_rectangles.sort(key=lambda rect: (rect[1], rect[0], rect[3], rect[2]))
    return tuple(placements)


def _placed_complete_part_group(placement: CutSheetPlacement) -> str:
    part = placement.part
    if placement.rotated:
        transform = (
            f"translate({_fmt(placement.x_mm)} {_fmt(placement.y_mm)}) "
            f"rotate(90) translate(0 -{_fmt(part.height_mm)})"
        )
        label_x = placement.x_mm
        label_y = max(4.0, placement.y_mm - 1.4)
    else:
        transform = f"translate({_fmt(placement.x_mm)} {_fmt(placement.y_mm)})"
        label_x = placement.x_mm
        label_y = max(4.0, placement.y_mm - 1.4)
    has_on_part_engraving = part.part_id.startswith(("gears:", "ring_gears:", "linkages:", "spacers:", "cams:", "followers:", "brackets:", "handles:"))
    external_label = "" if has_on_part_engraving else (
        f'\n  <text x="{_fmt(label_x)}" y="{_fmt(label_y)}" class="tiny" '
        f'text-anchor="start">{escape(part.label)}</text>'
    )
    return (
        f'  <g class="complete-cut-part" data-part-id="{escape(part.part_id)}" '
        f'data-rotated="{str(placement.rotated).lower()}" '
        f'transform="{transform}">\n'
        f"{chr(10).join(part.elements)}\n"
        "  </g>"
        f"{external_label}"
    )


def _complete_kit_cut_sheet(spec: FabricationSpec) -> SvgTemplate:
    parts = _complete_cut_part_templates(spec)
    placements: tuple[CutSheetPlacement, ...] | None = None
    width_mm, height_mm = COMPLETE_KIT_CUT_SHEET_SIZE_MM
    for candidate_width, candidate_height in COMPLETE_KIT_CUT_SHEET_SIZE_CANDIDATES_MM:
        try:
            placements = _pack_complete_cut_sheet_parts(
                parts,
                width_mm=candidate_width,
                height_mm=candidate_height,
            )
        except ValueError:
            continue
        width_mm, height_mm = candidate_width, candidate_height
        break
    if placements is None:
        raise ValueError(f"{COMPLETE_KIT_CUT_SHEET_PATH} cannot fit generated kit parts")
    letter_area = PRINTABLE_LANDSCAPE_MM[0] * PRINTABLE_LANDSCAPE_MM[1]
    part_area = sum(part.width_mm * part.height_mm for part in parts)
    part_quantities: dict[str, int] = {}
    for part in parts:
        part_quantities[part.part_id] = part_quantities.get(part.part_id, 0) + 1
    elements = [
        *_sheet_label(
            "Complete kit cut sheet",
            "Gears, linkages, and spacer washers for the classroom starter kit",
        ),
        _text(
            12.0,
            24.0,
            "Actual size. Includes two gear sets, two linkage sets, and extra spacers.",
            class_name="tiny",
            anchor="start",
        ),
        *[_placed_complete_part_group(placement) for placement in placements],
    ]
    return SvgTemplate(
        path=COMPLETE_KIT_CUT_SHEET_PATH,
        title="Automataii complete kit cut sheet",
        desc=(
            "One-page actual-size cutter-bed sheet containing the current gear, linkage, "
            "and spacer starter kit."
        ),
        width_mm=width_mm,
        height_mm=height_mm,
        elements=tuple(elements),
        metadata={
            "path": COMPLETE_KIT_CUT_SHEET_PATH,
            "width_mm": width_mm,
            "height_mm": height_mm,
            "actual_size": True,
            "letter_size": False,
            "part_count": len(parts),
            "included_part_categories": list(COMPLETE_KIT_INCLUDED_CATEGORIES),
            "excluded_part_categories": list(COMPLETE_KIT_EXCLUDED_CATEGORIES),
            "unique_part_ids": sorted(part_quantities),
            "part_quantities": part_quantities,
            "actual_part_area_mm2": round(part_area, 3),
            "letter_area_mm2": round(letter_area, 3),
            "letter_fit_possible": part_area <= letter_area,
            "note": "Current starter kit: 2 gear sets, 2 linkage sets, and 24 spacer washers.",
        },
    )


def _build_sheets(spec: FabricationSpec) -> list[SvgTemplate]:
    pitch_mm = spec.pitch_mm
    sheets: list[SvgTemplate] = []

    gear_sheet = _sheet_label(
        "01 Gear set A",
        f"Gears include {_fmt(spec.hole_diameter_mm)} mm axle + linkage/bracket/crank/handle holes",
    )
    gear_positions = [(12.0, 30.0), (62.0, 30.0), (154.0, 30.0)]
    for gear_preset, (x, y) in zip(spec.profile.gear_presets[:3], gear_positions, strict=True):
        elements, _ = _gear_elements(gear_preset, spec)
        gear_sheet.extend(_translate(element, x, y) for element in elements)
    sheets.append(_sheet_template("01-gear-set", "Gear set A", ["gears"], gear_sheet, spec))

    large_gear_sheet = _sheet_label(
        "10 Gear set B",
        "Large 7-space gear on its own Letter page at actual size",
    )
    elements, _ = _gear_elements(spec.profile.gear_presets[3], spec)
    large_gear_sheet.extend(_translate(element, 28.0, 36.0) for element in elements)
    sheets.append(
        _sheet_template(
            "10-gear-set-large",
            "Gear set B",
            ["gears"],
            large_gear_sheet,
            spec,
            width_mm=PRINTABLE_PORTRAIT_MM[0],
            height_mm=PRINTABLE_PORTRAIT_MM[1],
        )
    )

    ring_sheet = _sheet_label(
        "09 Planetary ring gear",
        "Fixed internal ring gear for the board-mounted planetary guide",
    )
    ring_template = _ring_gear_template(
        spec.profile.gear_presets[0], spec.profile.gear_presets[1], spec
    )
    ring_sheet.extend(_translate(element, 10.0, 28.0) for element in ring_template.elements)
    sheets.append(
        _sheet_template(
            "09-planetary-ring-set",
            "Planetary ring gear",
            ["ring_gears"],
            ring_sheet,
            spec,
            width_mm=PRINTABLE_PORTRAIT_MM[0],
            height_mm=PRINTABLE_PORTRAIT_MM[1],
        )
    )

    linkage_sheet = _sheet_label("02 Linkage set", "2/4/6/8-cell board-compatible linkage bars")
    for idx, cells in enumerate(spec.profile.linkage_length_cells):
        elements, _ = _linkage_elements(cells, spec)
        linkage_sheet.extend(_translate(element, 12.0, 30.0 + idx * 38.0) for element in elements)
    sheets.append(
        _sheet_template("02-linkage-set", "Linkage set", ["linkages"], linkage_sheet, spec)
    )

    cam_sheet = _sheet_label("03 Cam set", "Circle, eccentric, oval, and pear cams")
    cam_positions = [(16.0, 24.0), (116.0, 24.0), (16.0, 118.0), (116.0, 118.0)]
    for cam_preset, (x, y) in zip(spec.profile.cam_presets, cam_positions, strict=True):
        elements, _, _, _ = _cam_elements(cam_preset, spec)
        cam_sheet.extend(_translate(element, x, y) for element in elements)
    sheets.append(_sheet_template("03-cam-set", "Cam set", ["cams"], cam_sheet, spec))

    prototype_a = _sheet_label(
        "04 Prototype set A", "Starter mix: two gears, two linkages, two cams, brackets"
    )
    for gear_preset, (x, y) in zip(
        spec.profile.gear_presets[:2], [(14.0, 26.0), (104.0, 26.0)], strict=True
    ):
        elements, _ = _gear_elements(gear_preset, spec)
        prototype_a.extend(_translate(element, x, y) for element in elements)
    for cells, (x, y) in zip((2, 4), [(14.0, 118.0), (14.0, 150.0)], strict=True):
        elements, _ = _linkage_elements(cells, spec)
        prototype_a.extend(_translate(element, x, y) for element in elements)
    for cam_preset, (x, y) in zip(
        spec.profile.cam_presets[:2], [(190.0, 26.0), (190.0, 108.0)], strict=True
    ):
        elements, _, _, _ = _cam_elements(cam_preset, spec)
        prototype_a.extend(_translate(element, x, y) for element in elements)
    for bracket_preset, (x, y) in zip(
        BRACKET_PRESETS[:2], [(14.0, 180.0), (84.0, 180.0)], strict=True
    ):
        elements, _, _, _ = _bracket_elements(bracket_preset, spec)
        prototype_a.extend(_translate(element, x, y) for element in elements)
    sheets.append(
        _sheet_template(
            "04-prototype-set-a",
            "Prototype set A",
            ["gears", "linkages", "cams", "brackets"],
            prototype_a,
            spec,
        )
    )

    prototype_b = _sheet_label(
        "05 Prototype set B", "Extended mix: larger gears, longer linkages, profile cams, brackets"
    )
    for gear_preset, (x, y) in zip(
        spec.profile.gear_presets[2:3], [(12.0, 24.0)], strict=True
    ):
        elements, _ = _gear_elements(gear_preset, spec)
        prototype_b.extend(_translate(element, x, y) for element in elements)
    for cells, (x, y) in zip((6, 8), [(12.0, 118.0), (12.0, 154.0)], strict=True):
        elements, _ = _linkage_elements(cells, spec)
        prototype_b.extend(_translate(element, x, y) for element in elements)
    for cam_preset, (x, y) in zip(
        spec.profile.cam_presets[2:], [(12.0, 194.0), (112.0, 186.0)], strict=True
    ):
        elements, _, _, _ = _cam_elements(cam_preset, spec)
        prototype_b.extend(_translate(element, x, y) for element in elements)
    for bracket_preset, (x, y) in zip(
        BRACKET_PRESETS[2:], [(166.0, 122.0), (166.0, 158.0)], strict=True
    ):
        elements, _, _, _ = _bracket_elements(bracket_preset, spec)
        prototype_b.extend(_translate(element, x, y) for element in elements)
    sheets.append(
        _sheet_template(
            "05-prototype-set-b",
            "Prototype set B",
            ["gears", "linkages", "cams", "brackets"],
            prototype_b,
            spec,
            width_mm=PRINTABLE_PORTRAIT_MM[0],
            height_mm=PRINTABLE_PORTRAIT_MM[1],
        )
    )

    bracket_sheet = _sheet_label(
        "06 Bracket set",
        f"Bracket plates match the {pitch_mm:.0f} mm pegboard pitch and "
        f"{_fmt(spec.hole_diameter_mm)} mm holes",
    )
    bracket_positions = [(12.0, 30.0), (12.0, 62.0), (12.0, 96.0), (72.0, 96.0)]
    for bracket_preset, (x, y) in zip(BRACKET_PRESETS, bracket_positions, strict=True):
        elements, _, _, _ = _bracket_elements(bracket_preset, spec)
        bracket_sheet.extend(_translate(element, x, y) for element in elements)
    sheets.append(
        _sheet_template("06-bracket-set", "Bracket set", ["brackets"], bracket_sheet, spec)
    )

    follower_sheet = _sheet_label(
        "07 Follower set",
        "Slotted cam followers: guide on fixed "
        f"{_fmt(spec.hole_diameter_mm)} mm pins, output holes move with the cam",
    )
    follower_positions = [(12.0, 32.0), (78.0, 32.0), (144.0, 32.0), (210.0, 32.0)]
    for follower_preset, (x, y) in zip(
        spec.profile.follower_presets,
        follower_positions,
        strict=True,
    ):
        elements, _, _, _ = _follower_elements(follower_preset, spec)
        follower_sheet.extend(_translate(element, x, y) for element in elements)
    sheets.append(
        _sheet_template("07-follower-set", "Follower set", ["followers"], follower_sheet, spec)
    )

    spacer_sheet = _sheet_label(
        "08 Spacer set",
        f"Stackable washer spacers for {_fmt(spec.hole_diameter_mm)} mm axle/linkage hardware",
    )
    spacer_copies_per_size = 8
    for row, spacer_preset in enumerate(SPACER_PRESETS):
        y = 34.0 + row * 34.0
        for col in range(spacer_copies_per_size):
            elements, _, _, _ = _spacer_elements(spacer_preset, spec)
            spacer_sheet.extend(_translate(element, 82.0 + col * 22.0, y) for element in elements)
    sheets.append(_sheet_template("08-spacer-set", "Spacer set", ["spacers"], spacer_sheet, spec))

    handle_sheet = _sheet_label(
        "11 Handle set",
        "Simple rectangle: cut two left slits, fold the three 10 mm strips into 4 mm-hole tabs",
    )
    handle_positions = ((12.0, 34.0),)
    for handle_preset, (x, y) in zip(HANDLE_PRESETS, handle_positions, strict=True):
        elements, _, _, _ = _handle_elements(handle_preset, spec)
        handle_sheet.extend(_translate(element, x, y) for element in elements)
    sheets.append(_sheet_template("11-handle-set", "Handle set", ["handles"], handle_sheet, spec))

    return sheets


def _part_label(part_id: str) -> str:
    category, _, key = part_id.partition(":")
    if category == "cam_modules":
        return {
            "axle-peg": "Axle peg",
            "crank-handle": "Crank handle",
            "cam-lock-disk": "Cam lock",
            "paper-washer": "Paper washer",
            "cam-spacer": "Cam spacer",
            "swappable-cam-disk": "Cam disk",
            "u-channel-guide-cartridge": "Guide cartridge",
            "gravity-follower-module": "Gravity follower",
        }.get(key, key.replace("-", " ").title())
    if category == "ring_gears":
        return key.removeprefix("ring-").replace("-", "/").upper() + " Ring"
    if key.startswith("g") and key[1:].isdigit():
        return f"G{key[1:]}"
    if key.startswith("linkage-"):
        return key.replace("linkage-", "L").replace("-cell", "")
    if key.startswith("s") and key[1:].isdigit():
        return f"S{key[1:]}"
    return key.replace("-", " ").title()


def _part_category(part_id: str) -> str:
    category, _, _key = part_id.partition(":")
    return category or "parts"


def _part_color(part_id: str) -> str:
    category = _part_category(part_id)
    return {
        "gears": "#fbbf24",
        "ring_gears": "#f59e0b",
        "linkages": "#60a5fa",
        "cams": "#f472b6",
        "followers": "#34d399",
        "brackets": "#a78bfa",
        "spacers": "#94a3b8",
        "handles": "#fb7185",
        "cam_modules": "#f472b6",
    }.get(category, "#e5e7eb")


def _part_card_elements(
    part_id: str,
    *,
    x: float,
    y: float,
    step: int,
    index: int,
) -> list[str]:
    """Return a large, colored part callout for LEGO-style step scanning."""
    color = _part_color(part_id)
    label = _part_label(part_id)
    category = _part_category(part_id).rstrip("s").title()
    elements = [
        _rect(
            x,
            y,
            92.0,
            13.0,
            "score part-card",
            extra={"step": step, "part_key": part_id, "part_index": index},
            style=f"fill:{color};fill-opacity:0.22;stroke:{color};stroke-width:0.6",
        ),
        _circle(
            x + 8.0,
            y + 6.5,
            4.2,
            "score part-token",
            extra={"step": step, "part_key": part_id, "part_index": index},
        ),
        _text(x + 17.0, y + 5.7, label, class_name="part-card-label", anchor="start"),
        _text(x + 17.0, y + 10.4, category, class_name="tiny", anchor="start"),
    ]
    return elements


def _step_coord_labels(step: dict[str, object]) -> list[str]:
    coords = step.get("coords", [])
    if not isinstance(coords, list):
        return []
    return [str(coord) for coord in coords]


def _step_coord_roles(step: dict[str, object]) -> list[str]:
    coords = _step_coord_labels(step)
    roles = step.get("coord_roles", [])
    if not isinstance(roles, list):
        return ["board"] * len(coords)
    normalized = [str(role) for role in roles]
    if len(normalized) != len(coords):
        return ["board"] * len(coords)
    return normalized


def _step_coord_pairs(step: dict[str, object]) -> list[tuple[str, str]]:
    return list(zip(_step_coord_labels(step), _step_coord_roles(step), strict=False))


def _board_coord_labels(step: dict[str, object]) -> list[str]:
    return [coord for coord, role in _step_coord_pairs(step) if role == "board"]


def _reference_coord_labels(step: dict[str, object]) -> list[str]:
    return [coord for coord, role in _step_coord_pairs(step) if role != "board"]


def _step_part_ids(step: dict[str, object]) -> list[str]:
    parts = step.get("parts", [])
    if not isinstance(parts, list):
        return []
    ids: list[str] = []
    for item in parts:
        if isinstance(item, dict) and isinstance(item.get("part"), str):
            ids.append(str(item["part"]))
    return ids


def _step_stack_layers(step: dict[str, object]) -> list[dict[str, object]]:
    stack = step.get("stack", [])
    if not isinstance(stack, list):
        return []
    return [layer for layer in stack if isinstance(layer, dict)]


def _step_ghost_parts(step: dict[str, object]) -> list[str]:
    visual = step.get("visual_state")
    if not isinstance(visual, dict) or not isinstance(visual.get("ghost_parts"), list):
        return []
    return [str(part) for part in visual["ghost_parts"]]


def _coord_to_board_xy(coord: str, x: float, y: float, size: float) -> tuple[float, float]:
    return board_coord_to_svg_xy(coord, x=x, y=y, size=size)


def _short_svg_text(value: object, *, max_chars: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_chars:
        return text
    return text[: max(1, max_chars - 1)].rstrip(" ,.;:") + "…"


def _mini_gear_teeth(part_id: str) -> int:
    _, _, key = part_id.partition(":")
    if key.startswith("g") and key[1:].isdigit():
        return int(key[1:])
    return 12


def _mini_gear_path(cx: float, cy: float, radius: float, teeth: int) -> str:
    points: list[tuple[float, float]] = []
    root = max(1.0, radius * 0.82)
    outer = radius
    for tooth in range(max(6, min(teeth, 32))):
        base = 2.0 * math.pi * tooth / teeth
        for fraction, point_radius in ((0.08, root), (0.28, outer), (0.56, outer), (0.82, root)):
            theta = base + 2.0 * math.pi * fraction / teeth
            points.append(
                (cx + point_radius * math.cos(theta), cy + point_radius * math.sin(theta))
            )
    return _polygon_path(tuple(points))


def _mini_part_overlay_elements(
    part_ids: list[str],
    coords: list[str],
    *,
    board_x: float,
    board_y: float,
    board_size: float,
    step: int,
) -> list[str]:
    if not part_ids or not coords:
        return []
    coord_points = [_coord_to_board_xy(coord, board_x, board_y, board_size) for coord in coords]
    elements: list[str] = []
    for index, part_id in enumerate(part_ids):
        category = _part_category(part_id)
        color = _part_color(part_id)
        x1, y1 = coord_points[min(index, len(coord_points) - 1)]
        common_extra = {"step": step, "part_key": part_id, "part_index": index + 1}
        if category == "ring_gears":
            ring_cx = sum(point[0] for point in coord_points) / len(coord_points)
            ring_cy = sum(point[1] for point in coord_points) / len(coord_points)
            ring_radius = max(
                9.0, max(math.dist((ring_cx, ring_cy), point) for point in coord_points)
            )
            elements.append(
                _circle(
                    ring_cx,
                    ring_cy,
                    ring_radius + 2.8,
                    "score board-part ring-gear-part",
                    extra=common_extra,
                )
            )
            elements.append(
                _circle(
                    ring_cx,
                    ring_cy,
                    max(3.0, ring_radius * 0.68),
                    "score board-part ring-inner-reference",
                    extra=common_extra,
                )
            )
            for hole_idx, (hx, hy) in enumerate(coord_points):
                elements.append(
                    _circle(
                        hx,
                        hy,
                        1.0,
                        "drill board-part-hole ring-mount-hole",
                        extra={**common_extra, "hole_index": hole_idx},
                    )
                )
        elif category == "gears":
            teeth = _mini_gear_teeth(part_id)
            radius = max(5.4, min(8.4, teeth * 0.46))
            elements.append(
                _path(
                    _mini_gear_path(x1, y1, radius, teeth),
                    "score board-part gear-part",
                    extra=common_extra,
                    style=(
                        f"fill:{color};fill-opacity:0.48;stroke:#5c4033;"
                        "stroke-width:0.55;stroke-linejoin:round"
                    ),
                )
            )
            elements.append(_circle(x1, y1, 1.35, "drill board-part-hole", extra=common_extra))
            for hole_idx in range(4):
                theta = 2.0 * math.pi * hole_idx / 4.0
                elements.append(
                    _circle(
                        x1 + radius * 0.52 * math.cos(theta),
                        y1 + radius * 0.52 * math.sin(theta),
                        0.9,
                        "drill board-part-hole gear-attachment-hole",
                        extra={**common_extra, "hole_index": hole_idx},
                    )
                )
        elif category in {"linkages", "brackets"} and len(coord_points) >= 2:
            x1, y1 = coord_points[0]
            x2, y2 = coord_points[-1]
            elements.append(
                _path(
                    f"M {_fmt(x1)} {_fmt(y1)} L {_fmt(x2)} {_fmt(y2)}",
                    "score board-part linkage-part",
                    extra=common_extra,
                    style=(
                        f"fill:none;stroke:{color};stroke-opacity:0.72;"
                        "stroke-width:4.2;stroke-linecap:round"
                    ),
                )
            )
            for hole_idx, (hx, hy) in enumerate((coord_points[0], coord_points[-1])):
                elements.append(
                    _circle(
                        hx,
                        hy,
                        1.1,
                        "drill board-part-hole linkage-hole",
                        extra={**common_extra, "hole_index": hole_idx},
                    )
                )
        elif category == "spacers":
            elements.append(
                _circle(
                    x1,
                    y1,
                    2.9,
                    "score board-part spacer-part",
                    extra=common_extra,
                )
            )
            elements.append(_circle(x1, y1, 1.1, "drill board-part-hole", extra=common_extra))
        elif category == "cams":
            elements.append(
                _path(
                    f"M {_fmt(x1 - 6)} {_fmt(y1)} C {_fmt(x1 - 4)} {_fmt(y1 - 7)} "
                    f"{_fmt(x1 + 5)} {_fmt(y1 - 6)} {_fmt(x1 + 7)} {_fmt(y1)} "
                    f"C {_fmt(x1 + 5)} {_fmt(y1 + 6)} {_fmt(x1 - 5)} {_fmt(y1 + 7)} "
                    f"{_fmt(x1 - 6)} {_fmt(y1)} Z",
                    "score board-part cam-part",
                    extra=common_extra,
                    style=f"fill:{color};fill-opacity:0.45;stroke:#7c2d12;stroke-width:0.5",
                )
            )
            elements.append(_circle(x1, y1, 1.2, "drill board-part-hole", extra=common_extra))
        else:
            elements.append(
                _circle(
                    x1,
                    y1,
                    3.0,
                    "score board-part generic-part",
                    extra=common_extra,
                )
            )
    return elements


def _layout_box(step: int, zone: str, x: float, y: float, width: float, height: float) -> str:
    return _rect(
        x,
        y,
        width,
        height,
        "layout-box",
        extra={
            "layout_box": f"{step},{zone},{_fmt(x)},{_fmt(y)},{_fmt(width)},{_fmt(height)}",
            "step": step,
            "zone": zone,
        },
        style="fill:none;stroke:none",
    )


def _assembly_step_panel_height(step: dict[str, object]) -> float:
    part_rows = max(1, len(_step_part_ids(step)))
    stack_rows = len(_step_stack_layers(step))
    ghost_rows = len(_step_ghost_parts(step))
    row_count = max(6, part_rows, stack_rows, ghost_rows + 3)
    return max(116.0, 38.0 + row_count * 13.0)


def _assembly_board_grid_elements(
    *,
    x: float,
    y: float,
    size: float,
    hole_radius: float = 0.72,
    highlighted: list[str] | None = None,
    references: list[str] | None = None,
    step: int | None = None,
) -> list[str]:
    highlighted = highlighted or []
    references = references or []
    pitch = size / max(1, len(BOARD_COLUMNS) - 1)
    outline_inset = 5.0
    elements: list[str] = [_rect(x - outline_inset, y - outline_inset, size + 2.0 * outline_inset, size + 2.0 * outline_inset, "score board-outline")]
    for row_index, row in enumerate(BOARD_ROWS):
        elements.append(
            _text(
                x + row_index * pitch,
                y - 7.0,
                row,
                class_name="coord-label",
                anchor="middle",
                extra={"axis": "horizontal", "index": row_index + 1, "label": row},
            )
        )
    for col in BOARD_COLUMNS:
        elements.append(
            _text(
                x - 7.0,
                y + (col - 1) * pitch,
                str(col),
                class_name="coord-label",
                anchor="end",
                extra={"axis": "vertical", "index": col, "label": str(col)},
            )
        )
    for row in BOARD_ROWS:
        for col in BOARD_COLUMNS:
            label = f"{row}{col}"
            cx, cy = _coord_to_board_xy(label, x, y, size)
            class_name = "drill board-hole"
            extra: dict[str, object] = {"board_coord": label}
            if step is not None:
                extra["step"] = step
            if label in highlighted:
                class_name = "drill board-hole active-board-hole"
            elements.append(_circle(cx, cy, hole_radius, class_name, extra=extra))
    for label in references:
        cx, cy = _coord_to_board_xy(label, x, y, size)
        reference_extra: dict[str, object] = {"reference_coord": label}
        if step is not None:
            reference_extra["step"] = step
        elements.append(
            _circle(
                cx,
                cy,
                hole_radius * 1.8,
                "score reference-coordinate",
                extra=reference_extra,
            )
        )
    return elements


def _main_board_template(
    spec: FabricationSpec,
    *,
    path: str,
    title: str,
    desc: str,
    width_mm: float,
    board_role: str = "assembly-board-map",
) -> SvgTemplate:
    board_size = spec.pitch_mm * (len(BOARD_COLUMNS) - 1)
    hole_radius = spec.hole_diameter_mm / 2.0
    origin = 15.0
    elements = [
        '  <g id="layer-board-grid" class="board-grid">',
        *_assembly_board_grid_elements(
            x=origin,
            y=origin,
            size=board_size,
            hole_radius=hole_radius,
        ),
        "  </g>",
    ]
    return SvgTemplate(
        path=path,
        title=title,
        desc=desc,
        width_mm=width_mm,
        height_mm=width_mm,
        elements=tuple(elements),
        metadata={
            "board_role": board_role,
            "rows": len(BOARD_ROWS),
            "columns": len(BOARD_COLUMNS),
            "style_profile": "board-only",
            "path": path,
            "hole_diameter_mm": spec.hole_diameter_mm,
            "pitch_mm": spec.pitch_mm,
            "outline": {
                "x": _fmt(origin - 5.0),
                "y": _fmt(origin - 5.0),
                "width": _fmt(board_size + 10.0),
                "height": _fmt(board_size + 10.0),
            },
        },
    )


def _main_board_asset_template(spec: FabricationSpec) -> SvgTemplate:
    return _main_board_template(
        spec,
        path="board-final.svg",
        title="MotionSmith 15x15 main board",
        desc="Main fabrication board with 4 mm holes and engraved A-O / 1-15 coordinates.",
        board_role="main-board",
        width_mm=305.0,
    )


def _stack_label(layer: dict[str, object]) -> str:
    role = str(layer.get("role", ""))
    label = str(layer.get("label", role))
    if role == "carrier-hole":
        return "Carrier hole"
    if role == "gear-handle-hole":
        return "Gear handle hole"
    if role == "link-end-hole":
        return "Link end hole"
    if role in {"spacer", "top-spacer"}:
        return label.replace(" spacer", "")
    if role == "moving-part":
        part = str(layer.get("part", ""))
        return _part_label(part)
    if role == "paper-fastener":
        return "Fastener"
    if role == "fastener-tabs":
        return "Loose tabs"
    return label


def _coord_heading_for_step(step: dict[str, object]) -> str:
    roles = set(_step_coord_roles(step))
    if roles and roles <= {"board"}:
        return "Board holes"
    if "board" in roles:
        return "Board/ref"
    if "gear_handle_reference" in roles:
        return "Gear/handle ref"
    if "link_end_reference" in roles:
        return "Link-end ref"
    if "link_joint_reference" in roles:
        return "Link-joint ref"
    if "slider_reference" in roles:
        return "Slider ref"
    if "carrier_reference" in roles:
        return "Carrier ref"
    roles = {str(layer.get("role", "")) for layer in _step_stack_layers(step)}
    if "gear-handle-hole" in roles and "board" not in roles:
        return "Gear/handle ref"
    if "link-end-hole" in roles and "board" not in roles:
        return "Link-end ref"
    if "carrier-hole" in roles and "board" not in roles:
        return "Carrier ref"
    if "carrier-hole" in roles:
        return "Board/carrier refs"
    return "Board holes"


def _assembly_step_panel(recipe: dict[str, object], step: dict[str, object], y: float) -> list[str]:
    recipe_key = str(recipe["key"])
    mechanism_type = str(recipe["mechanism_type"])
    raw_step_n = step.get("n")
    step_n = raw_step_n if isinstance(raw_step_n, int) else 0
    title = str(step["title"])
    instruction = str(step["instruction"])
    check = str(step["check"])
    coords = _step_coord_labels(step)
    board_coords = _board_coord_labels(step)
    reference_coords = _reference_coord_labels(step)
    part_ids = _step_part_ids(step)
    stack_layers = _step_stack_layers(step)
    ghost_parts = _step_ghost_parts(step)
    panel_height = _assembly_step_panel_height(step)
    content_height = panel_height - 30.0
    board_x, board_y, board_size = 150.0, y + 30.0, 82.0

    elements: list[str] = [
        _rect(8.0, y, 544.0, panel_height, "score step-card"),
        _text(16.0, y + 11.0, f"{step_n}", class_name="coord-label", anchor="start"),
        _text(28.0, y + 10.5, title, class_name="step-title", anchor="start"),
        _text(28.0, y + 17.0, instruction, class_name="small", anchor="start"),
        _layout_box(step_n, "parts", 16.0, y + 22.0, 112.0, content_height),
        _layout_box(step_n, "board", 142.0, y + 22.0, 104.0, content_height),
        _layout_box(step_n, "stack", 262.0, y + 22.0, 92.0, content_height),
        _layout_box(step_n, "check", 372.0, y + 22.0, 164.0, content_height),
        f'  <g id="layer-callouts-step-{step_n}" data-step="{step_n}" data-recipe-key="{escape(recipe_key)}">',
        _text(18.0, y + 29.0, "Parts to add now", class_name="small", anchor="start"),
    ]
    if part_ids:
        for idx, part in enumerate(part_ids):
            elements.extend(
                _part_card_elements(
                    part,
                    x=20.0,
                    y=y + 34.0 + idx * 15.0,
                    step=step_n,
                    index=idx + 1,
                )
            )
    else:
        elements.extend(
            [
                _rect(
                    20.0,
                    y + 34.0,
                    92.0,
                    13.0,
                    "score part-card",
                    extra={"step": step_n, "part_key": "paper-fastener", "part_index": 1},
                    style="fill:#f97316;fill-opacity:0.18;stroke:#f97316;stroke-width:0.6",
                ),
                _text(
                    28.0, y + 42.5, "Paper Fastener", class_name="part-card-label", anchor="start"
                ),
            ]
        )
    elements.append("  </g>")

    elements.extend(
        [
            f'  <g id="layer-board-grid-step-{step_n}" data-step="{step_n}" data-recipe-key="{escape(recipe_key)}">',
            *_assembly_board_grid_elements(
                x=board_x,
                y=board_y,
                size=board_size,
                highlighted=board_coords,
                references=reference_coords,
                step=step_n,
            ),
            "  </g>",
            f'  <g id="layer-previous-step-ghost-step-{step_n}" data-step="{step_n}">',
        ]
    )
    for idx, part in enumerate(ghost_parts):
        elements.append(
            _text(
                146.0,
                y + 117.0 + idx * 5.0,
                _part_label(part),
                class_name="tiny",
                anchor="start",
            )
        )
    elements.append("  </g>")

    elements.append(
        f'  <g id="layer-new-part-highlight-step-{step_n}" data-step="{step_n}" '
        f'data-app-mechanism="{escape(mechanism_type)}">'
    )
    for coord in board_coords:
        cx, cy = _coord_to_board_xy(coord, board_x, board_y, board_size)
        elements.append(
            _circle(
                cx,
                cy,
                2.3,
                "score new-part-highlight",
                extra={
                    "step": step_n,
                    "recipe_key": recipe_key,
                    "board_coord": coord,
                    "app_mechanism": mechanism_type,
                },
            )
        )
    for coord in reference_coords:
        cx, cy = _coord_to_board_xy(coord, board_x, board_y, board_size)
        elements.append(
            _circle(
                cx,
                cy,
                2.1,
                "score reference-marker",
                extra={
                    "step": step_n,
                    "recipe_key": recipe_key,
                    "reference_coord": coord,
                    "app_mechanism": mechanism_type,
                },
            )
        )
    elements.append("  </g>")

    elements.append(
        f'  <g id="layer-existing-parts-step-{step_n}" data-step="{step_n}" '
        f'data-app-mechanism="{escape(mechanism_type)}">'
    )
    elements.extend(
        _mini_part_overlay_elements(
            part_ids,
            coords,
            board_x=board_x,
            board_y=board_y,
            board_size=board_size,
            step=step_n,
        )
    )
    elements.append("  </g>")

    elements.extend(
        [
            f'  <g id="layer-stack-diagram-step-{step_n}" data-step="{step_n}">',
            _text(266.0, y + 29.0, "Fastener stack", class_name="small", anchor="start"),
        ]
    )
    for idx, layer in enumerate(stack_layers):
        layer_y = y + 38.0 + idx * 9.5
        layer_role = str(layer.get("role", "layer"))
        layer_part = str(layer.get("part", ""))
        elements.append(
            _rect(
                268.0,
                layer_y - 5.5,
                34.0,
                5.0,
                "score stack-layer",
                extra={
                    "step": step_n,
                    "stack_layer": idx + 1,
                    "stack_role": layer_role,
                    "part_key": layer_part,
                },
            )
        )
        elements.append(
            _text(308.0, layer_y, _stack_label(layer), class_name="tiny", anchor="start")
        )
    elements.append("  </g>")

    coord_text = ", ".join(coords)
    coord_heading = _coord_heading_for_step(step)
    part_text = " ".join(_part_label(part) for part in part_ids)
    elements.extend(
        [
            f'  <g id="layer-labels-step-{step_n}" data-step="{step_n}" data-board-coord="{escape(coord_text)}" data-part-key="{escape(part_text)}">',
            _text(
                376.0,
                y + 31.0,
                f"{coord_heading}: {coord_text}",
                class_name="small",
                anchor="start",
            ),
            _text(376.0, y + 45.0, "Check", class_name="part-card-label", anchor="start"),
            _text(376.0, y + 53.0, check, class_name="small", anchor="start"),
            _text(
                376.0,
                y + 72.0,
                "Spacer rule: spacer below moving part.",
                class_name="tiny",
                anchor="start",
            ),
            _text(
                376.0,
                y + 80.0,
                "Paper fastener tabs stay loose until tested.",
                class_name="tiny",
                anchor="start",
            ),
            "  </g>",
            f'  <g id="layer-fasteners-step-{step_n}" data-step="{step_n}"></g>',
            f'  <g id="layer-spacers-step-{step_n}" data-step="{step_n}"></g>',
            f'  <g id="layer-motion-arrows-step-{step_n}" data-step="{step_n}">',
            _path(
                f"M 484 {y + 94:.3f} L 522 {y + 94:.3f} L 514 {y + 88:.3f} M 522 {y + 94:.3f} L 514 {y + 100:.3f}",
                "score motion-arrow",
            ),
            "  </g>",
        ]
    )
    return elements


def _assembly_recipe_template(recipe: dict[str, object], spec: FabricationSpec) -> SvgTemplate:
    steps = recipe.get("steps", [])
    step_dicts = (
        [step for step in steps if isinstance(step, dict)] if isinstance(steps, list) else []
    )
    width_mm, height_mm = PRINTABLE_LANDSCAPE_MM
    mechanism_type = str(recipe["mechanism_type"])
    layer_content: dict[str, list[str]] = {
        "layer-board-grid": [],
        "layer-previous-step-ghost": [],
        "layer-existing-parts": [],
        "layer-new-part-highlight": [],
        "layer-fasteners": [],
        "layer-spacers": [],
        "layer-motion-arrows": [],
        "layer-callouts": [],
        "layer-labels": [],
        "layer-stack-diagram": [],
    }
    elements: list[str] = [
        _rect(8.0, 8.0, width_mm - 16.0, height_mm - 16.0, "score step-card"),
        _text(14.0, 17.0, str(recipe["title"]), anchor="start"),
        _text(
            14.0,
            25.0,
            "Source SVG preview. Export Blueprint Package for the full PDF step cards.",
            class_name="tiny",
            anchor="start",
        ),
        _text(14.0, 35.0, "Parts to add now", class_name="small", anchor="start"),
        _text(103.0, 35.0, "Board/ref", class_name="small", anchor="start"),
        _text(151.0, 35.0, "Fastener stack", class_name="small", anchor="start"),
    ]
    card_w = 122.0
    card_h = 49.0
    card_gap_x = 10.0
    card_gap_y = 9.0
    card_origin_x = 14.0
    card_origin_y = 42.0
    for step_index, step in enumerate(step_dicts):
        card_col = step_index % 2
        card_row = step_index // 2
        x = card_origin_x + card_col * (card_w + card_gap_x)
        y = card_origin_y + card_row * (card_h + card_gap_y)
        raw_step_n = step.get("n")
        step_n = raw_step_n if isinstance(raw_step_n, int) else step_index + 1
        title = str(step.get("title", f"Step {step_n}"))
        coords = _step_coord_labels(step)
        board_coords = _board_coord_labels(step)
        reference_coords = _reference_coord_labels(step)
        part_ids = _step_part_ids(step)
        stack_layers = _step_stack_layers(step)
        coord_heading = _coord_heading_for_step(step)
        elements.append(_rect(x, y, card_w, card_h, "score step-card"))
        elements.append(_layout_box(step_n, "parts", x + 5.0, y + 15.0, 46.0, 10.0))
        elements.append(_layout_box(step_n, "board", x + 87.0, y + 9.0, 28.0, 17.0))
        elements.append(_layout_box(step_n, "stack", x + 5.0, y + 26.0, 103.0, 9.0))
        elements.append(_layout_box(step_n, "check", x + 5.0, y + 36.0, 103.0, 8.0))
        layer_content["layer-callouts"].append(
            _text(x + 5.0, y + 8.0, f"{step_n}", class_name="coord-label", anchor="start")
        )
        layer_content["layer-callouts"].append(
            _text(
                x + 16.0,
                y + 7.6,
                _short_svg_text(title, max_chars=29),
                class_name="part-card-label",
                anchor="start",
            )
        )
        if part_ids:
            for part_index, part_id in enumerate(part_ids[:2]):
                label = _short_svg_text(_part_label(part_id), max_chars=14)
                token_x = x + 7.0 + part_index * 25.0
                color = _part_color(part_id)
                layer_content["layer-existing-parts"].append(
                    _rect(
                        token_x,
                        y + 16.0,
                        22.0,
                        7.5,
                        "score part-card",
                        extra={"step": step_n, "part_key": part_id, "part_index": part_index + 1},
                        style=f"fill:{color};fill-opacity:0.22;stroke:{color};stroke-width:0.5",
                    )
                )
                layer_content["layer-existing-parts"].append(
                    _text(token_x + 11.0, y + 21.0, label, class_name="tiny")
                )
        else:
            layer_content["layer-fasteners"].append(
                _rect(
                    x + 7.0,
                    y + 16.0,
                    34.0,
                    7.5,
                    "score part-card",
                    extra={"step": step_n, "part_key": "hardware:paper-fastener", "part_index": 1},
                    style="fill:#f97316;fill-opacity:0.18;stroke:#f97316;stroke-width:0.5",
                )
            )
            layer_content["layer-fasteners"].append(
                _text(x + 24.0, y + 21.0, "Paper fastener", class_name="tiny")
            )
        layer_content["layer-labels"].append(
            _text(
                x + 58.0,
                y + 15.0,
                _short_svg_text(f"{coord_heading}: {', '.join(coords)}", max_chars=30),
                class_name="tiny",
                anchor="start",
            )
        )
        for coord_index, coord in enumerate(board_coords[:4]):
            marker_x = x + 92.0 + coord_index * 5.0
            marker_y = y + 22.0
            layer_content["layer-board-grid"].append(
                _circle(
                    marker_x,
                    marker_y,
                    1.15,
                    "drill board-hole active-board-hole",
                    extra={"step": step_n, "board_coord": coord},
                )
            )
            layer_content["layer-new-part-highlight"].append(
                _circle(
                    marker_x,
                    marker_y,
                    1.8,
                    "score new-part-highlight",
                    extra={
                        "step": step_n,
                        "board_coord": coord,
                        "app_mechanism": mechanism_type,
                    },
                )
            )
        for coord_index, coord in enumerate(reference_coords[:4]):
            marker_x = x + 92.0 + (len(board_coords[:4]) + coord_index) * 5.0
            marker_y = y + 22.0
            layer_content["layer-board-grid"].append(
                _circle(
                    marker_x,
                    marker_y,
                    1.15,
                    "drill board-hole reference-coordinate",
                    extra={"step": step_n, "board_coord": coord},
                )
            )
            layer_content["layer-new-part-highlight"].append(
                _circle(
                    marker_x,
                    marker_y,
                    1.8,
                    "score reference-marker",
                    extra={
                        "step": step_n,
                        "reference_coord": coord,
                        "app_mechanism": mechanism_type,
                    },
                )
            )
        for stack_index, layer in enumerate(stack_layers[:1]):
            label = _short_svg_text(_stack_label(layer), max_chars=24)
            part_key = str(layer.get("part", ""))
            role = str(layer.get("role", "layer"))
            layer_content["layer-stack-diagram"].append(
                _rect(
                    x + 7.0,
                    y + 27.0 + stack_index * 7.0,
                    9.0,
                    4.6,
                    "score stack-layer",
                    extra={
                        "step": step_n,
                        "stack_layer": stack_index + 1,
                        "stack_role": role,
                        "part_key": part_key,
                    },
                )
            )
            layer_content["layer-stack-diagram"].append(
                _text(
                    x + 19.0,
                    y + 31.0 + stack_index * 7.0,
                    label,
                    class_name="tiny",
                    anchor="start",
                )
            )
            if role in {"spacer", "top-spacer"}:
                layer_content["layer-spacers"].append(
                    _circle(
                        x + 13.0,
                        y + 29.3 + stack_index * 7.0,
                        1.0,
                        "score spacer-part",
                        extra={"step": step_n, "part_key": part_key},
                    )
                )
            if role == "paper-fastener":
                layer_content["layer-fasteners"].append(
                    _circle(
                        x + 13.0,
                        y + 29.3 + stack_index * 7.0,
                        0.9,
                        "drill fastener",
                        extra={"step": step_n, "part_key": "hardware:paper-fastener"},
                    )
                )
        repeat_labels = [
            str(layer.get("label", ""))
            for layer in stack_layers
            if str(layer.get("role", "")) == "repeat-fastener-sites"
            and str(layer.get("label", "")).strip()
        ]
        for repeat_index, label in enumerate(repeat_labels[:1]):
            layer_content["layer-stack-diagram"].append(
                _text(
                    x + 19.0,
                    y + 45.0 + repeat_index * 3.5,
                    label,
                    class_name="tiny",
                    anchor="start",
                )
            )
    for layer_id, content in layer_content.items():
        elements.append(f'  <g id="{layer_id}">')
        elements.extend(content)
        elements.append("  </g>")
    return SvgTemplate(
        path=str(recipe["guide_svg"]),
        title=f"Automataii assembly guide {recipe['key']}",
        desc=(
            f"Printable source SVG preview for {recipe['title']}; "
            "the app export composes full PDF step cards."
        ),
        width_mm=width_mm,
        height_mm=height_mm,
        elements=tuple(elements),
        metadata={
            "key": recipe["key"],
            "label": recipe["title"],
            "path": recipe["guide_svg"],
            "mechanism_type": recipe["mechanism_type"],
            "step_count": len(step_dicts),
            "schema_version": ASSEMBLY_SCHEMA_VERSION,
        },
    )


def _recipe_part_ids(recipe: dict[str, object]) -> list[str]:
    seen: dict[str, None] = {}
    raw_parts = recipe.get("parts", [])
    if isinstance(raw_parts, list):
        for item in raw_parts:
            if isinstance(item, dict) and isinstance(item.get("part"), str):
                seen[str(item["part"])] = None
    raw_steps = recipe.get("steps", [])
    if isinstance(raw_steps, list):
        for step in raw_steps:
            if isinstance(step, dict):
                for part in _step_part_ids(step):
                    seen[part] = None
                for layer in _step_stack_layers(step):
                    layer_part = layer.get("part")
                    if isinstance(layer_part, str):
                        seen[layer_part] = None
    return list(seen)


def _assembly_all_part_ids(assembly_package: dict[str, object]) -> list[str]:
    seen: dict[str, None] = {}
    raw_recipes = assembly_package.get("recipes", [])
    recipes = raw_recipes if isinstance(raw_recipes, list) else []
    for recipe in recipes:
        if isinstance(recipe, dict):
            for part in _recipe_part_ids(recipe):
                seen[part] = None
    return list(seen)


def _assembly_parts_overview_template(assembly_package: dict[str, object]) -> SvgTemplate:
    part_ids = _assembly_all_part_ids(assembly_package)
    width_mm, height_mm = PRINTABLE_LANDSCAPE_MM
    columns = 3
    card_w = 80.0
    card_h = 11.0
    gap_x = 7.0
    gap_y = 4.0
    max_rows = 10
    elements: list[str] = [
        _text(10.0, 12.0, "Printable part checklist", anchor="start"),
        _text(
            10.0,
            21.0,
            "Source SVG preview. The app exports quantity-aware kit-parts-to-cut.pdf.",
            class_name="tiny",
            anchor="start",
        ),
    ]
    shown_part_ids = part_ids[: columns * max_rows]
    for idx, part_id in enumerate(shown_part_ids):
        col = idx % columns
        row = idx // columns
        x = 12.0 + col * (card_w + gap_x)
        y = 30.0 + row * (card_h + gap_y)
        color = _part_color(part_id)
        elements.extend(
            [
                _rect(
                    x,
                    y,
                    card_w,
                    card_h,
                    "score part-card",
                    extra={"part_key": part_id, "part_index": idx + 1},
                    style=f"fill:{color};fill-opacity:0.2;stroke:{color};stroke-width:0.6",
                ),
                _circle(
                    x + 7.0,
                    y + 5.5,
                    3.2,
                    "score part-token",
                    extra={"part_key": part_id, "part_index": idx + 1},
                ),
                _text(
                    x + 14.0,
                    y + 5.0,
                    _short_svg_text(_part_label(part_id), max_chars=18),
                    class_name="part-card-label",
                    anchor="start",
                ),
                _text(
                    x + 14.0,
                    y + 9.0,
                    _short_svg_text(part_id, max_chars=33),
                    class_name="tiny",
                    anchor="start",
                ),
            ]
        )
    if len(part_ids) > len(shown_part_ids):
        elements.append(
            _text(
                10.0,
                height_mm - 12.0,
                f"See recipes.json for {len(part_ids) - len(shown_part_ids)} more part type(s).",
                class_name="tiny",
                anchor="start",
            )
        )
    return SvgTemplate(
        path="assembly/parts-overview.svg",
        title="Automataii assembly printable part checklist",
        desc="Compact visual checklist for parts used by the board assembly guides.",
        width_mm=width_mm,
        height_mm=height_mm,
        elements=tuple(elements),
        metadata={
            "key": "parts-overview",
            "label": "Printable part checklist",
            "path": "assembly/parts-overview.svg",
            "part_count": len(part_ids),
        },
    )


def _assembly_templates(
    assembly_package: dict[str, object],
    spec: FabricationSpec,
) -> list[SvgTemplate]:
    templates = [
        _assembly_parts_overview_template(assembly_package),
    ]
    raw_recipes = assembly_package.get("recipes", [])
    recipes = (
        [recipe for recipe in raw_recipes if isinstance(recipe, dict)]
        if isinstance(raw_recipes, list)
        else []
    )
    templates.extend(_assembly_recipe_template(recipe, spec) for recipe in recipes)
    return templates


def _assembly_readme_text(assembly_package: dict[str, object]) -> str:
    recipes = assembly_package.get("recipes", [])
    recipe_rows: list[str] = []
    if isinstance(recipes, list):
        for recipe in recipes:
            if isinstance(recipe, dict):
                recipe_rows.append(
                    f"- `{recipe['key']}` — {recipe['title']} ({len(recipe.get('steps', []))} steps)"
                )
    return f"""# Automataii board assembly guides

Use this folder when you already have the fabricated kit parts and want to build on
the 15x15 hole board (15 rows x 15 columns = 225 board holes).

## How to use

1. In the app, use **Export Blueprint Package** for the normal PDF-first flow. It writes
   `current-design-cut-sheets.pdf`, `assembly/assembly-guide.pdf`, and
   `assembly/kit-parts-to-cut.pdf` into the folder you choose.
2. Use this committed `fabrication/assembly/` folder as the source template set only:
   `../board-final.svg`, `index.html`, and per-mechanism SVGs are generator/debug inputs
   for the PDF package.
3. Open `../board-final.svg` only when you need to inspect the 225 row-letter/column-number
   holes directly.
4. Follow one step card at a time: place the fastener at the called-out hole, then add spacers
   and parts in the exact `Stack` row order before running the check.
5. Keep paper fasteners loose enough for rotation or sliding before flattening the tabs.

## Character attachment

- Cut character body components from the current character blueprint/cut sheet. There is no
  separate Example Character fabrication template.
- Use paper fasteners for pivot/drive holes and keep spacers between moving character parts,
  linkage layers, and the board or bracket.
- Align character drive holes to the mechanism output shown in the guide; the cut sheet makes
  parts, while this guide decides board holes and per-step stack order.

## Guides

{chr(10).join(recipe_rows)}

## Data contract

- `recipes.json` is the semantic source of truth for board coordinates, parts, stack order, and app visual mappings.
- Guide SVGs are render targets. They include `data-step`, `data-board-coord`, `data-part-key`, `data-stack-layer`, `data-layout-box`, and `data-app-mechanism` metadata for tests and future app previews.
- Self-fabrication cut sheets stay in the sibling part and `sheets/` folders.
"""


def _manifest_part_paths(manifest: dict[str, object]) -> dict[str, str]:
    raw_parts = manifest.get("parts", {})
    result: dict[str, str] = {}
    if not isinstance(raw_parts, dict):
        return result
    for category, raw_items in raw_parts.items():
        if not isinstance(category, str) or not isinstance(raw_items, list):
            continue
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            key = item.get("key")
            path = item.get("path")
            if key is None and isinstance(path, str):
                key = path.rsplit("/", 1)[-1].removesuffix(".svg")
            if isinstance(key, str) and isinstance(path, str):
                result[f"{category}:{key}"] = path
    return result


def _assembly_index_html(
    assembly_package: dict[str, object],
    manifest: dict[str, object],
) -> str:
    raw_recipes = assembly_package.get("recipes", [])
    recipes = (
        [recipe for recipe in raw_recipes if isinstance(recipe, dict)]
        if isinstance(raw_recipes, list)
        else []
    )
    part_paths = _manifest_part_paths(manifest)
    recipe_sections: list[str] = []
    for recipe in recipes:
        step_rows: list[str] = []
        raw_steps = recipe.get("steps", [])
        steps = raw_steps if isinstance(raw_steps, list) else []
        for step in steps:
            if not isinstance(step, dict):
                continue
            coords = ", ".join(_step_coord_labels(step))
            parts = (
                ", ".join(_part_label(part) for part in _step_part_ids(step)) or "Paper fastener"
            )
            coord_heading = _coord_heading_for_step(step)
            stack_labels = [
                str(layer.get("label", "")).strip()
                for layer in _step_stack_layers(step)
                if str(layer.get("label", "")).strip()
            ]
            stack_row = (
                f'<span class="stack">Stack: {html.escape(" → ".join(stack_labels))}</span>'
                if stack_labels
                else ""
            )
            step_rows.append(
                "<li>"
                f"<strong>{html.escape(str(step.get('n', '')))}. "
                f"{html.escape(str(step.get('title', '')))}</strong>"
                f"<span>{html.escape(coord_heading)}: {html.escape(coords)}</span>"
                f"<span>Parts: {html.escape(parts)}</span>"
                f"<span>{html.escape(str(step.get('instruction', '')))}</span>"
                f"{stack_row}"
                "</li>"
            )
        parts_cards: list[str] = []
        for part_id in _recipe_part_ids(recipe):
            rel_path = part_paths.get(part_id, "")
            href = f"../{rel_path}" if rel_path else "#"
            parts_cards.append(
                '<a class="part-card" '
                f'style="--part-color:{_part_color(part_id)}" '
                f'href="{html.escape(href)}">'
                f'<span class="part-token">{html.escape(_part_label(part_id))}</span>'
                f"<span>{html.escape(part_id)}</span>"
                "</a>"
            )
        guide_href = html.escape(Path(str(recipe.get("guide_svg", ""))).name)
        recipe_sections.append(
            '<section class="guide">'
            f"<h2>{html.escape(str(recipe.get('title', 'Assembly guide')))}</h2>"
            f'<p><a href="{guide_href}">Open SVG source preview</a> '
            "(print the app-exported assembly-guide.pdf for full step cards)</p>"
            "<h3>Print/cut these parts first</h3>"
            f'<div class="parts-grid">{"".join(parts_cards)}</div>'
            "<h3>Assembly order</h3>"
            f'<ol class="steps">{"".join(step_rows)}</ol>'
            "</section>"
        )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Automataii board assembly guide</title>
  <style>
    body {{ font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #111827; }}
    header {{ border-bottom: 3px solid #111827; margin-bottom: 24px; padding-bottom: 12px; }}
    h1 {{ margin: 0 0 8px; }}
    .quick-start, .guide, .callout {{ border: 1px solid #d1d5db; border-radius: 14px; padding: 18px; margin: 18px 0; }}
    .callout {{ border-color: #f97316; background: #fff7ed; }}
    .quick-start li, .steps li {{ margin: 12px 0; }}
    .steps span {{ display: block; margin-top: 4px; }}
    .stack {{ color: #92400e; font-weight: 600; }}
    .parts-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }}
    .part-card {{ border: 2px solid var(--part-color); background: color-mix(in srgb, var(--part-color) 18%, white); border-radius: 12px; padding: 10px; text-decoration: none; color: inherit; display: flex; gap: 10px; align-items: center; }}
    .part-token {{ font-weight: 700; background: var(--part-color); border-radius: 999px; padding: 8px 10px; min-width: 44px; text-align: center; }}
    @media print {{ body {{ margin: 12mm; }} .guide {{ break-inside: avoid; }} }}
  </style>
</head>
<body>
  <header>
    <h1>Automataii board assembly</h1>
    <p>
      15 x 15 means 225 board holes. This is the board-coordinate assembly guide,
      not the cut sheet. Make the character/mechanism parts first, then use row
      letters and column numbers on the board map.
    </p>
  </header>
  <section class="callout">
    <h2>Character attachment rule</h2>
    <p>
      Use the current character body components from the Parts Blueprint/Cut Sheets.
      Do not introduce a separate Example Character template. Attach each moving character
      part to the mechanism output with a paper fastener, keep a spacer between moving layers
      and the board/bracket, and flatten the fastener tabs only after the motion clears.
    </p>
    <p>
      Follow each step's <b>Stack</b> row exactly. Typical moving stack:
      board hole → paper fastener → spacer → character part or linkage →
      spacer → fastener tabs.
    </p>
  </section>
  <section class="quick-start">
    <h2>Quick start</h2>
    <ol>
      <li>Print or fabricate the linked part templates.</li>
      <li>Open <a href="../board-final.svg">board-final.svg</a> and find the called-out holes.</li>
      <li>Put the paper fastener through the board, then follow that step's Stack row exactly before leaving the tabs loose.</li>
      <li>After each step, run the motion check before adding the next layer.</li>
    </ol>
  </section>
  <p><a href="parts-overview.svg">Open printable part checklist</a></p>
  {"".join(recipe_sections)}
</body>
</html>
"""


def _readme_text(spec: FabricationSpec, manifest: dict[str, object]) -> str:
    pitch_mm = spec.pitch_mm
    managed_count = (
        len(manifest["managed_files"]) if isinstance(manifest["managed_files"], list) else 0
    )
    gear_teeth = ", ".join(
        f"{preset.label} ({preset.teeth} teeth)" for preset in spec.profile.gear_presets
    )
    linkage_lengths = ", ".join(str(cells) for cells in spec.profile.linkage_length_cells)
    cam_names = ", ".join(preset.key for preset in spec.profile.cam_presets)
    sheet_count = len(manifest["sheets"]) if isinstance(manifest["sheets"], list) else 0

    return f"""# Automataii fabrication templates

This directory contains fabrication-ready SVG masters for the physical Automataii pegboard kit.

## Two supported workflows

1. **Board assembly** — open `assembly/`, choose a guide SVG, and follow the board-coordinate step cards with the pre-fabricated kit parts.
2. **Self-fabrication** — use the individual SVGs in `gears/`, `ring_gears/`, `linkages/`, `cams/`, `followers/`, `brackets/`, `spacers/`, and `handles/` to make replacement or custom parts with a laser cutter, CNC router, 3D-print workflow, scroll saw, table saw plus drill jig, or similar shop process.

For a repeatable workshop set, use `complete-kit-cut-sheet.svg` when you have a
cutter bed large enough for one actual-size master. It intentionally exceeds Letter
size because all unique parts cannot physically fit on one Letter page at 1:1.
For home printers, cut/print the {sheet_count} Letter workshop sheets in `sheets/`,
sort the parts, then use the matching `assembly/` guide.

## Physical assumptions

- Default committed pitch: `{pitch_mm:.1f} mm` (`{pitch_mm / 10.0:.2f} cm`) board spacing.
- Main board map is canonically `board-final.svg` (15x15, 225 holes).
- Nominal axle/linkage/bracket hole diameter: `{spec.hole_diameter_mm:.1f} mm`.
- Gear presets: {gear_teeth}.
- Linkage lengths: {linkage_lengths} board cells.
- Cam presets: {cam_names}.
- Follower presets: round-nose, roller-pin, flat-shoe, linkage-output.
- Bracket presets: 2-hole straight, 3-hole straight, L 3-hole, triangle 3-hole.
- Spacer preset: S10 only, a 10 mm outside-diameter stackable washer.
- Handle preset: triangular paper-tent glue handle only; previous crank/tripod
  handles are intentionally removed from the generated package.
- Default profile key: `{spec.profile.key}`. Legacy `ms4n` / `motionsmith-ms4n`
  identifiers are compatibility labels; the committed fabrication contract is
  this 20.0 mm / {spec.hole_diameter_mm:.1f} mm board unless a custom output directory is generated.
- Red paths are cuts, blue circles are drill/cut holes, gray lines are score/reference geometry.
- Gear attachment-hole pattern: gears expose only axle holes or board-grid attachment holes;
  no gear uses non-grid fallback holes. Cams may use radial crank/linkage/handle holes only
  when a separate {_fmt(spec.hole_diameter_mm)} mm hole can preserve enough material around the axle.
- Follower guide geometry: followers use {_fmt(spec.hole_diameter_mm)} mm-wide vertical slots, not fixed round board holes,
  so fixed board pins/brackets can constrain the part while still allowing cam lift travel.

## Tolerance note

These files are nominal geometry, not material-specific kerf compensation. Before a workshop run, cut a small test coupon and adjust hole scaling/kerf for the chosen material, fasteners, printer, bit, or laser. The gears are educational/prototyping gears for automata experiments, not certified power-transmission gears.

## Relationship to `kit/`

`kit/` and `fabrication/` are intentionally separate physical-asset packages:

- `kit/` contains the existing educational/module-oriented MS4N activity sheets, prompt cards, checks, and broad classroom materials.
- `fabrication/` is the nominal-millimetre manufacturing package for the constrained physical parts requested here: gears, planetary ring gears, linkage bars, cams, followers, brackets, spacers, handles, and workshop cut sheets.
- Shared physical assumptions come from `fabrication/generate_fabrication_templates.py` and are mirrored by `utils/fabrication.ts`; do not hand-edit generated `fabrication/` SVGs without updating the generators and drift tests.
- `board-final.svg` is managed by `scripts/generate-fabrication-board.ts` (TypeScript source in
  `utils/fabricationBoardTemplate.tsx`) so board geometry and drift checks are reusable across
  runtime and tooling.

## Contents

- `manifest.json` — machine-readable inventory and dimensions.
- `complete-kit-cut-sheet.svg` — one actual-size cutter-bed page containing every unique physical part type.
- `board-final.svg` — canonical 15x15 pegboard map with A/O and 1/15 labels.
- `assembly/` — board-coordinate assembly guides, recipe data, and per-mechanism SVG guides.
- `gears/` — one SVG per gear preset; every gear includes a {_fmt(spec.hole_diameter_mm)} mm axle hole, and larger gears include {_fmt(spec.hole_diameter_mm)} mm linkage/bracket/crank/handle holes on the board grid.
- `ring_gears/` — fixed internal ring gear for the planetary guide, with board-mount holes.
- `linkages/` — one SVG per linkage length; holes are spaced on the board pitch.
- `cams/` — one SVG per cam preset; each cam includes a {_fmt(spec.hole_diameter_mm)} mm axle hole and {_fmt(spec.hole_diameter_mm)} mm linkage/bracket/crank/handle attachment holes.
- `followers/` — slotted cam follower parts with {_fmt(spec.hole_diameter_mm)} mm guide slots and {_fmt(spec.hole_diameter_mm)} mm linkage/output holes.
- `brackets/` — bracket plates for the pegboard/bracket assembly style shown in the reference image.
- `spacers/` — washer spacers for stack clearance between the board, gears, cams, links, and brackets.
- `handles/` — one simple rectangular paper-tent handle: cut the outer rectangle
  and the two visible left-side slits, score the prism folds on the right, fold
  each 10 mm tab strip into a four-layer bundle, pass through a 4 mm hole, then
  hot-glue. No thin neck is used.
- `sheets/` — {sheet_count} workshop sheets for pre-fabricated sets.

Managed files in this generated package: {managed_count}.

## Regeneration

```bash
python3 fabrication/generate_fabrication_templates.py --output fabrication
```

```bash
bun scripts/generate-fabrication-board.ts --output fabrication
```

`generate_fabrication_templates.py` still controls non-board mechanism parts and recipe
assets. Use the TypeScript board generator for board map regeneration.

For a custom 2.5 cm board pitch, generate to a separate directory instead of overwriting the committed package:

```bash
python3 fabrication/generate_fabrication_templates.py --output /tmp/automataii-fabrication-2_5cm --grid-cell-cm 2.5
```
"""


def _write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def _existing_managed_files(output_path: Path) -> set[str]:
    manifest_path = output_path / "manifest.json"
    if not manifest_path.exists():
        return set()
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return set()
    managed_files = manifest.get("managed_files")
    if not isinstance(managed_files, list):
        return set()
    return {str(path) for path in managed_files}


def _managed_file_target(output_path: Path, rel_path: str) -> Path | None:
    relative = Path(rel_path)
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        return None
    try:
        output_root = output_path.resolve()
        target = (output_path / relative).resolve()
        target.relative_to(output_root)
    except (OSError, ValueError):
        return None
    return target


def _remove_stale_managed_files(
    output_path: Path,
    previous_managed_files: set[str],
    current_managed_files: set[str],
) -> None:
    for rel_path in sorted(previous_managed_files - current_managed_files):
        target = _managed_file_target(output_path, rel_path)
        if target is None:
            continue
        if target.is_file() or target.is_symlink():
            target.unlink()


def _round_float(value: float) -> float:
    return round(value, 3)


def write_fabrication_templates(
    output_dir: str | Path,
    grid_cell_cm: float | None = None,
    profile: PhysicalKitProfile = DEFAULT_PHYSICAL_KIT_PROFILE,
) -> dict[str, object]:
    """Write fabrication SVGs and return the manifest dictionary."""

    output_path = Path(output_dir)
    spec = _fabrication_spec(grid_cell_cm, profile)

    gear_templates = [_gear_template(preset, spec) for preset in profile.gear_presets]
    ring_gear_templates = [
        _ring_gear_template(profile.gear_presets[0], profile.gear_presets[1], spec)
    ]
    linkage_templates = [_linkage_template(cells, spec) for cells in profile.linkage_length_cells]
    cam_templates = [_cam_template(preset, spec) for preset in profile.cam_presets]
    follower_templates = [_follower_template(preset, spec) for preset in profile.follower_presets]
    bracket_templates = [_bracket_template(preset, spec) for preset in BRACKET_PRESETS]
    spacer_templates = [_spacer_template(preset, spec) for preset in SPACER_PRESETS]
    handle_templates = [_handle_template(preset, spec) for preset in HANDLE_PRESETS]
    cam_module_templates = [_cam_module_template(preset, spec) for preset in CAM_MODULE_PRESETS]
    complete_cut_sheet_template = _complete_kit_cut_sheet(spec)
    sheet_templates = _build_sheets(spec)
    main_board_template = _main_board_asset_template(spec)

    fabrication_svg_templates = [
        main_board_template,
        complete_cut_sheet_template,
        *gear_templates,
        *ring_gear_templates,
        *linkage_templates,
        *cam_templates,
        *follower_templates,
        *bracket_templates,
        *spacer_templates,
        *handle_templates,
        *cam_module_templates,
        *sheet_templates,
    ]
    base_manifest: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "profile_key": profile.key,
        "grid_pitch_mm": _round_float(spec.pitch_mm),
        "grid_cell_cm": _round_float(spec.pitch_mm / 10.0),
        "hole_diameter_mm": spec.hole_diameter_mm,
        "board_rows": profile.board_rows,
        "board_columns": profile.board_columns,
        "generated_by": GENERATED_BY,
        "generated_at": REPRODUCIBLE_GENERATED_AT,
        "source_ssot": SOURCE_SSOT,
        "parts": {
            "gears": [template.metadata for template in gear_templates],
            "ring_gears": [template.metadata for template in ring_gear_templates],
            "linkages": [template.metadata for template in linkage_templates],
            "cams": [template.metadata for template in cam_templates],
            "followers": [template.metadata for template in follower_templates],
            "brackets": [template.metadata for template in bracket_templates],
            "spacers": [template.metadata for template in spacer_templates],
            "handles": [template.metadata for template in handle_templates],
            "cam_modules": [template.metadata for template in cam_module_templates],
        },
        "complete_cut_sheet": complete_cut_sheet_template.metadata,
        "sheets": [template.metadata for template in sheet_templates],
        "managed_files": [],
    }
    assembly_package = build_default_assembly_package(base_manifest, profile=profile)
    assembly_templates = _assembly_templates(assembly_package, spec)
    all_svg_templates = [*fabrication_svg_templates, *assembly_templates]
    raw_recipes = assembly_package.get("recipes", [])
    recipe_guide_paths = {
        str(recipe.get("guide_svg"))
        for recipe in raw_recipes
        if isinstance(recipe, dict) and isinstance(recipe.get("guide_svg"), str)
    }
    assembly_files = [
        "assembly/README.md",
        "assembly/index.html",
        "assembly/recipes.json",
        *[template.path for template in assembly_templates],
    ]
    managed_file_candidates = [
        *[template.path for template in all_svg_templates],
        "README.md",
        "manifest.json",
        *assembly_files,
    ]
    managed_files = sorted(dict.fromkeys(managed_file_candidates))
    previous_managed_files = _existing_managed_files(output_path)

    manifest: dict[str, object] = {
        **base_manifest,
        "assembly": {
            "schema_version": ASSEMBLY_SCHEMA_VERSION,
            "recipes_source": "assembly/recipes.json",
            "board_map": "board-final.svg",
            "guide_files": [
                template.path
                for template in assembly_templates
                if template.path in recipe_guide_paths
            ],
            "files": assembly_files,
        },
        "managed_files": managed_files,
    }

    _remove_stale_managed_files(output_path, previous_managed_files, set(managed_files))
    for template in all_svg_templates:
        _write_text(
            output_path / template.path,
            _svg_document(template, spec),
        )
    _write_text(
        output_path / "assembly" / "recipes.json",
        json.dumps(assembly_package, indent=2, sort_keys=True) + "\n",
    )
    _write_text(output_path / "assembly" / "README.md", _assembly_readme_text(assembly_package))
    _write_text(
        output_path / "assembly" / "index.html",
        _assembly_index_html(assembly_package, manifest),
    )
    _write_text(
        output_path / "manifest.json", json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    _write_text(output_path / "README.md", _readme_text(spec, manifest))
    return manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "fabrication",
        help="Output directory for generated fabrication files (default: fabrication/).",
    )
    parser.add_argument(
        "--grid-cell-cm",
        type=float,
        default=DEFAULT_GRID_CELL_CM,
        help="Board pitch in centimetres for generated geometry (default: 2.0).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    manifest = write_fabrication_templates(args.output, grid_cell_cm=args.grid_cell_cm)
    files = manifest.get("managed_files", [])
    count = len(files) if isinstance(files, list) else 0
    print(f"Generated {count} fabrication files in {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
