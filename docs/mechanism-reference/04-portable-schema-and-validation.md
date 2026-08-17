# 04 — Portable Schema and Validation

This file gives an app-neutral schema for porting mechanism units and assembly guides. It is not a formal JSON Schema file; it is the minimum contract another implementation should preserve.

## 4.1 Mechanism instance schema

```json
{
  "schema_version": "automataii.mechanism.portable.v1",
  "mechanism_id": "mechanism-001",
  "mechanism_type": "four_bar",
  "physical_context": {
    "enabled": true,
    "profile_key": "motionsmith-ms4n",
    "grid_pitch_choice": "2cm",
    "grid_cell_cm": 2.0,
    "grid_pitch_mm": 20.0,
    "hole_diameter_mm": 4.0,
    "board_rows": 15,
    "board_columns": 15
  },
  "parameters": {
    "ground_link": 80.0,
    "input_link": 40.0,
    "coupler_link": 80.0,
    "output_link": 40.0,
    "input_angle": 30.0
  },
  "parts": [
    {"part_id": "linkages:linkage-2-cell", "count": 2, "role": "input-output-links"},
    {"part_id": "linkages:linkage-4-cell", "count": 1, "role": "coupler"},
    {"part_id": "spacers:s10", "count": 8, "role": "clearance"}
  ],
  "board_pose": {
    "origin_coord": "H8",
    "origin_mode": "center",
    "x_mm": 0.0,
    "y_mm": 0.0,
    "rotation_deg": 0.0,
    "scale": 1.0
  },
  "key_points": {
    "A": {"coord": "I5", "coord_role": "board", "label": "input ground pivot"},
    "B": {"coord": "G6", "coord_role": "link_joint_reference", "label": "input/coupler joint"},
    "C": {"coord": "G10", "coord_role": "link_joint_reference", "label": "coupler/output joint"},
    "D": {"coord": "I9", "coord_role": "board", "label": "output ground pivot"}
  },
  "motion": {
    "input_angle_deg": 30.0,
    "valid_input_angle_ranges_deg": [[0.0, 112.0], [248.0, 360.0]],
    "full_rotation": false,
    "solver_status": "partial_valid"
  },
  "assembly_recipe_key": "four-bar-basic"
}
```

## 4.2 Board coordinate object

```json
{
  "coord": "I5",
  "row": "I",
  "column": 5,
  "origin": "center",
  "x_cell": -3,
  "y_cell": 1,
  "x_mm": -60.0,
  "y_mm": 20.0,
  "coord_role": "board"
}
```

Validation:

- `row ∈ A..O`.
- `column ∈ 1..15`.
- `coord == row + column`.
- If origin is `center`: `x_cell = column - 8`, `y_cell = row_index - 7`.
- If origin is `top-left`: `x_cell = column - 1`, `y_cell = row_index`.

## 4.3 Part object schema

```json
{
  "part_id": "gears:g24",
  "category": "gears",
  "key": "g24",
  "label": "G3 / 3-space gear",
  "path": "fabrication/gears/gear-24t.svg",
  "count": 1,
  "geometry": {
    "hole_diameter_mm": 4.0,
    "pitch_radius_mm": 30.0,
    "attachment_hole_centers_mm": [[0.0, -20.0], [-20.0, 0.0], [20.0, 0.0], [0.0, 20.0]]
  }
}
```

Required part object fields for portability:

| Field | Rule |
|---|---|
| `part_id` | Must match `<category>:<key>`. |
| `category` | Must match one of the known part categories. |
| `key` | Must match source manifest key. |
| `label` | Human-readable label. |
| `count` | Positive integer. |
| `geometry.hole_diameter_mm` | Must be `4.0` for current package. |

## 4.4 Stack layer schema

```json
{
  "order": 3,
  "role": "spacer",
  "label": "S10 spacer",
  "part": "spacers:s10"
}
```

Required validation:

```pseudo
orders = [layer.order for layer in stack]
assert orders == sorted(unique(orders))
assert any(layer.role == "paper-fastener" for layer in stack)
for layer in stack:
    if layer.role in {"spacer", "top-spacer"}:
        assert layer.part == "spacers:s10"
```

## 4.5 Assembly step schema

```json
{
  "n": 2,
  "action": "add-linkage",
  "title": "Add input link",
  "instruction": "Place L2 from I5 toward G6 with spacers.",
  "coords": ["I5", "G6"],
  "coord_roles": ["board", "link_end_reference"],
  "parts": [
    {"part": "spacers:s10", "count": 8},
    {"part": "linkages:linkage-2-cell", "count": 1}
  ],
  "stack": [
    {"order": 1, "role": "board", "label": "Board hole I5"},
    {"order": 2, "role": "paper-fastener", "label": "Paper fastener"},
    {"order": 3, "role": "spacer", "label": "S10 spacer", "part": "spacers:s10"},
    {"order": 4, "role": "moving-part", "label": "L2 linkage", "part": "linkages:linkage-2-cell"},
    {"order": 5, "role": "top-spacer", "label": "S10 spacer", "part": "spacers:s10"},
    {"order": 6, "role": "fastener-tabs", "label": "Open tabs loosely"}
  ],
  "check": "The input link swings freely.",
  "app_mapping": {
    "mechanism_type": "four_bar",
    "component_role": "input-link",
    "highlight_ids": ["spacers:s10", "linkages:linkage-2-cell"]
  },
  "visual_state": {
    "active_parts": ["spacers:s10", "linkages:linkage-2-cell"],
    "ghost_parts": [],
    "highlight_coords": ["I5", "G6"]
  }
}
```

## 4.6 Recipe schema

```json
{
  "key": "four-bar-basic",
  "title": "Four-bar linkage",
  "mechanism_type": "four_bar",
  "guide_svg": "assembly/03-four-bar-basic.svg",
  "parts": [
    {"part": "linkages:linkage-2-cell", "count": 2},
    {"part": "linkages:linkage-4-cell", "count": 1},
    {"part": "spacers:s10", "count": 8}
  ],
  "steps": [],
  "compatibility": [],
  "app_mapping": {
    "mechanism_type": "four_bar",
    "component_role": "recipe",
    "highlight_ids": ["linkages:linkage-2-cell", "linkages:linkage-4-cell"]
  }
}
```

## 4.7 Motion validity contract

For all mechanisms, distinguish physical buildability from full-cycle simulation validity.

```json
{
  "motion_validity": {
    "buildable": true,
    "full_rotation": false,
    "valid_input_angle_ranges_deg": [[12.0, 148.0]],
    "invalid_reason": null,
    "display_policy": "show_valid_ranges_only"
  }
}
```

Rules:

1. A mechanism can be buildable even when not valid over 360°.
2. Four-bar and slider-crank should expose valid angle ranges when closure fails outside a range.
3. UI should not silently snap to a geometry different from the displayed handles.
4. If a point is shown on the canvas, its stored `key_points` value must match its rendered position after the same transform.
5. If physical snapping changes a parameter, the UI must update the displayed numeric field and the canvas handle together.

## 4.8 App-wide validation checklist

### Inventory validation

- [ ] Every `part_id` is present in `source/fabrication-manifest.snapshot.json` or declared as hardware (`paper-fastener`).
- [ ] Counts are positive integers.
- [ ] Required S10 spacer count is available.
- [ ] Gear-linkage driven gear has attachment holes.
- [ ] Planetary ring matches selected sun/planet pair.

### Coordinate validation

- [ ] All board coordinates are inside `A1..O15`.
- [ ] Validate every translated `board` / `board_axle` coordinate from every assembly step against the active physical-kit board before recommending, using, or exporting a mechanism; one valid main anchor is not sufficient.
- [ ] `coord_roles` length equals `coords` length.
- [ ] Non-board roles are not exported as fixed board pivots.
- [ ] `link_end_reference`, `link_joint_reference`, `gear_handle_reference`, `carrier_reference`, and `slider_reference` remain moving/part-local holes and must not be treated as board holes.
- [ ] Multi-hole fixed parts include all fixed board sites.

### Stack validation

- [ ] Orders are strictly increasing.
- [ ] Spacer layers use `spacers:s10`.
- [ ] Board-fixed moving parts use lower-z `S10` spacer → moving part → fastener head; floating joints use the spacer profile required by their adjacent moving layers.
- [ ] Fixed parts do not include top spacer unless intentionally specified by a new profile.
- [ ] Loose tabs are used for moving joints.
- [ ] Behind-board tabs are used for fixed stacks.

### Mechanism validation

- [ ] `four_bar`: exactly two board pivots and two floating joints.
- [ ] `gear_train`: centre distance matches gear radii sum within tolerance.
- [ ] `gear_linkage`: crank pin is a gear attachment hole, not board axle.
- [ ] `cam_follower`: cam preset and follower guide are compatible with sliding travel.
- [ ] `planetary_gear`: planet axle is carrier-mounted, ring is fixed.
- [ ] `slider_crank`: guide fixed, slider block moving.

### Rendering/export validation

- [ ] Same transform is used for board, mechanism geometry, handles, blueprint, and assembly guide overlays.
- [ ] Repeated identical mechanism types are exported as separate instances, not merged by type key.
- [ ] Step `app_mapping.highlight_ids` may contain duplicate part ids; preserve count/instance identity in UI.
- [ ] Guide SVG metadata (`data-step`, `data-board-coord`, `data-part-key`, `data-stack-layer`, `data-layout-box`, `data-app-mechanism`) is kept or replaced with equivalent structured data.
