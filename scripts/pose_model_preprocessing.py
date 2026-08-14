"""Product-aligned image preprocessing for pose calibration and quality checks.

Optional NumPy and Pillow imports stay lazy so the quantizer can explain a
missing build dependency after parsing ``--help``.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any


np: Any = None
Image: Any = None

INPUT_SIZE = (192, 256)
MAX_WORKING_EDGE = 1_024
MAX_WORKING_PIXELS = 1_000_000
FOREGROUND_CROP_MARGIN = 0.2


class PreprocessingDependencyError(RuntimeError):
    """Raised when deterministic calibration preprocessing cannot run."""


def load_dependencies() -> None:
    """Load NumPy and Pillow only when preprocessing is actually requested."""

    global np, Image
    if np is not None and Image is not None:
        return
    try:
        import numpy as numpy_module
        from PIL import Image as image_module
    except ModuleNotFoundError as error:
        missing = error.name or "an optional package"
        raise PreprocessingDependencyError(
            "Pose preprocessing is blocked: missing Python package "
            f"'{missing}'. Install numpy and Pillow, then rerun this command."
        ) from error
    np = numpy_module
    Image = image_module


def bounded_size(width: int, height: int) -> tuple[int, int]:
    scale = min(
        1.0,
        MAX_WORKING_EDGE / max(width, height),
        math.sqrt(MAX_WORKING_PIXELS / max(1, width * height)),
    )
    return max(1, math.floor(width * scale + 0.5)), max(1, math.floor(height * scale + 0.5))


def keep_significant_components(mask: Any, width: int, height: int) -> Any:
    labels = np.full(width * height, -1, dtype=np.int32)
    areas: list[int] = []
    queue = np.empty(width * height, dtype=np.int32)
    label = 0
    for start in range(width * height):
        if not mask[start] or labels[start] != -1:
            continue
        head = 0
        tail = 0
        area = 0
        labels[start] = label
        queue[tail] = start
        tail += 1
        while head < tail:
            index = int(queue[head])
            head += 1
            area += 1
            x = index % width
            y = index // width
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if not dx and not dy:
                        continue
                    nx = x + dx
                    ny = y + dy
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    next_index = ny * width + nx
                    if mask[next_index] and labels[next_index] == -1:
                        labels[next_index] = label
                        queue[tail] = next_index
                        tail += 1
        areas.append(area)
        label += 1
    if not areas:
        return mask
    threshold = max(64, sum(areas) * 0.003, max(areas) * 0.01)
    keep = np.zeros(width * height, dtype=np.uint8)
    for index, component in enumerate(labels):
        if component >= 0 and areas[int(component)] >= threshold:
            keep[index] = 255
    return keep if np.any(keep) else mask


def foreground_mask(rgba: Any) -> tuple[Any, tuple[int, int, int, int]]:
    height, width, _ = rgba.shape
    alpha_variance = np.abs(rgba[:, :, 3].astype(np.int16) - 255).sum()
    luma = 0.299 * rgba[:, :, 0] + 0.587 * rgba[:, :, 1] + 0.114 * rgba[:, :, 2]
    white_pixels = int(np.count_nonzero(luma > 240))
    alpha_driven = alpha_variance > rgba.size * 0.01
    line_art = white_pixels / (width * height) > 0.4
    if alpha_driven:
        mask = np.where(rgba[:, :, 3] > 10, 255, 0).astype(np.uint8)
    elif line_art:
        mask = np.where(luma < 242, 255, 0).astype(np.uint8)
    else:
        mask = np.where((luma < 245) & (luma > 8), 255, 0).astype(np.uint8)
    clean = keep_significant_components(mask.reshape(-1), width, height).reshape(height, width)
    ys, xs = np.where(clean)
    if not len(xs):
        return clean, (0, 0, width, height)
    return clean, (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))


def pose_crop_bounds(
    bbox: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    x, y, box_width, box_height = bbox
    crop_x = max(0.0, x - box_width * FOREGROUND_CROP_MARGIN)
    crop_y = max(0.0, y - box_height * FOREGROUND_CROP_MARGIN)
    right = min(float(width), x + box_width * (1 + FOREGROUND_CROP_MARGIN))
    bottom = min(float(height), y + box_height * (1 + FOREGROUND_CROP_MARGIN))
    return crop_x, crop_y, max(1.0, right - crop_x), max(1.0, bottom - crop_y)


def product_image(path: Path) -> Any:
    load_dependencies()
    image = Image.open(path).convert("RGBA")
    size = bounded_size(image.width, image.height)
    if size != (image.width, image.height):
        image = image.resize(size, Image.Resampling.BILINEAR)
    return image


def image_input(path: Path) -> Any:
    image = product_image(path)
    rgba = np.asarray(image, dtype=np.uint8)
    _, bbox = foreground_mask(rgba)
    crop_x, crop_y, crop_width, crop_height = pose_crop_bounds(bbox, image.width, image.height)
    image = image.crop((crop_x, crop_y, crop_x + crop_width, crop_y + crop_height)).resize(
        INPUT_SIZE,
        Image.Resampling.BILINEAR,
    ).convert("RGB")
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    mean = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
    normalized = (pixels - mean) / std
    return np.transpose(normalized, (2, 0, 1))[None, ...].astype(np.float32, copy=False)


def contract_evidence(path: Path) -> dict[str, object]:
    image = product_image(path)
    rgba = np.asarray(image, dtype=np.uint8)
    _, bbox = foreground_mask(rgba)
    crop = pose_crop_bounds(bbox, image.width, image.height)
    return {
        "fixture": path.as_posix(),
        "working": {"width": image.width, "height": image.height},
        "foreground": {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3]},
        "crop": {"x": crop[0], "y": crop[1], "width": crop[2], "height": crop[3]},
    }
