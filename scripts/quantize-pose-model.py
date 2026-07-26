#!/usr/bin/env python3
"""Build and quality-gate the browser INT8 pose model."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_static,
)


MEAN_DISPLACEMENT_LIMIT_PERCENT = 0.5
MAX_DISPLACEMENT_LIMIT_PERCENT = 3.0
EXACT_MATCH_FLOOR_PERCENT = 80.0


class CalibrationInputs(CalibrationDataReader):
    def __init__(self, path: Path, input_name: str) -> None:
        archive = np.load(path)
        self.samples = [
            {input_name: archive[key].astype(np.float32, copy=False)}
            for key in sorted(archive.files)
        ]
        self.index = 0

    def get_next(self) -> dict[str, np.ndarray] | None:
        if self.index >= len(self.samples):
            return None
        sample = self.samples[self.index]
        self.index += 1
        return sample

    def rewind(self) -> None:
        self.index = 0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pose_points(output: np.ndarray) -> np.ndarray:
    heatmaps = output.reshape(output.shape[-3], -1)
    indices = np.argmax(heatmaps, axis=1)
    width = output.shape[-1]
    return np.column_stack((indices % width, indices // width))


def quality_evidence(
    source_model: Path,
    runtime_model: Path,
    calibration: CalibrationInputs,
) -> dict[str, float | int]:
    source = ort.InferenceSession(
        str(source_model),
        providers=["CPUExecutionProvider"],
    )
    runtime = ort.InferenceSession(
        str(runtime_model),
        providers=["CPUExecutionProvider"],
    )
    distances: list[float] = []
    exact = 0
    total = 0
    diagonal = math.hypot(64, 48)
    for sample in calibration.samples:
        source_output = source.run(None, sample)[0]
        runtime_output = runtime.run(None, sample)[0]
        source_points = pose_points(source_output)
        runtime_points = pose_points(runtime_output)
        displacement = np.linalg.norm(source_points - runtime_points, axis=1)
        distances.extend((displacement / diagonal * 100).tolist())
        exact += int(np.count_nonzero(np.all(source_points == runtime_points, axis=1)))
        total += source_points.shape[0]
    return {
        "samples": len(calibration.samples),
        "keypoints": total,
        "mean_normalized_argmax_displacement_percent": float(np.mean(distances)),
        "max_normalized_argmax_displacement_percent": float(np.max(distances)),
        "exact_argmax_match_percent": exact / total * 100,
    }


def assert_quality(evidence: dict[str, float | int]) -> None:
    if not (
        evidence["mean_normalized_argmax_displacement_percent"] <= MEAN_DISPLACEMENT_LIMIT_PERCENT
        and evidence["max_normalized_argmax_displacement_percent"] <= MAX_DISPLACEMENT_LIMIT_PERCENT
        and evidence["exact_argmax_match_percent"] >= EXACT_MATCH_FLOOR_PERCENT
    ):
        raise RuntimeError(f"INT8 quality gate failed: {evidence}")


def build(source: Path, calibration_path: Path, output: Path) -> dict[str, object]:
    source_session = ort.InferenceSession(
        str(source),
        providers=["CPUExecutionProvider"],
    )
    input_name = source_session.get_inputs()[0].name
    calibration = CalibrationInputs(calibration_path, input_name)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="motionsmith-pose-int8-") as temp_dir:
        quantized = Path(temp_dir) / "pose_model.int8.qdq.onnx"
        quantize_static(
            source,
            quantized,
            calibration,
            quant_format=QuantFormat.QDQ,
            activation_type=QuantType.QInt8,
            weight_type=QuantType.QInt8,
            per_channel=False,
            calibrate_method=CalibrationMethod.MinMax,
        )
        options = ort.SessionOptions()
        options.optimized_model_filepath = str(output)
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        options.add_session_config_entry("session.save_model_format", "ORT")
        ort.InferenceSession(
            str(quantized),
            options,
            providers=["CPUExecutionProvider"],
        )
        evidence = quality_evidence(source, output, calibration)
        assert_quality(evidence)
        return {
            "source_sha256": sha256(source),
            "calibration_sha256": sha256(calibration_path),
            "quantized_onnx_sha256": sha256(quantized),
            "runtime_sha256": sha256(output),
            "runtime_bytes": output.stat().st_size,
            "quality": evidence,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("models/source/pose_model.fp32.onnx"),
    )
    parser.add_argument(
        "--calibration",
        type=Path,
        default=Path("models/calibration/pose-inputs.npz"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/onnx/pose_model.int8.ort"),
    )
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.calibration, args.output), indent=2))


if __name__ == "__main__":
    main()
