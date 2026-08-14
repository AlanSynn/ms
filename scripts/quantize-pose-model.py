#!/usr/bin/env python3
"""Build or quality-check the browser pose model without network inputs.

Calibration is generated deterministically from the committed representative
image fixtures. The quality gate also evaluates the FP32 and INT8 runtimes on
those fixtures, keeping calibration inputs and product evidence explicit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import tempfile
from pathlib import Path
from typing import Any, Iterable

import pose_model_preprocessing as preprocessing

ort: Any = None
CalibrationMethod: Any = None
QuantFormat: Any = None
QuantType: Any = None
quantize_static: Any = None


class QuantizerDependencyError(RuntimeError):
    """Raised when the optional model-quantization runtime is unavailable."""


def load_dependencies() -> None:
    """Load optional quantization dependencies only after CLI parsing."""

    global ort, CalibrationMethod, QuantFormat, QuantType, quantize_static
    if ort is not None:
        return
    try:
        import onnxruntime as ort_module
        from onnxruntime.quantization import (
            CalibrationMethod as calibration_method,
            QuantFormat as quant_format,
            QuantType as quant_type,
            quantize_static as quantize,
        )
    except ModuleNotFoundError as error:
        missing = error.name or "an optional package"
        raise QuantizerDependencyError(
            "Pose quantization is blocked: missing Python package "
            f"'{missing}'. Install numpy, Pillow, onnx, and onnxruntime "
            "in the active Python environment, then rerun this command."
        ) from error
    preprocessing.load_dependencies()
    ort = ort_module
    CalibrationMethod = calibration_method
    QuantFormat = quant_format
    QuantType = quant_type
    quantize_static = quantize


MEAN_DISPLACEMENT_LIMIT_PERCENT = 0.5
P95_DISPLACEMENT_LIMIT_PERCENT = 1.5
MAX_DISPLACEMENT_LIMIT_PERCENT = 3.0
EXACT_MATCH_FLOOR_PERCENT = 80.0
def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fixture_inputs(paths: Iterable[Path]) -> list[tuple[str, dict[str, Any]]]:
    return [(path.as_posix(), {}) for path in paths]


class FixtureDataReader:
    def __init__(self, samples: list[tuple[str, dict[str, Any]]], input_name: str) -> None:
        self.samples = [(label, {input_name: preprocessing.image_input(Path(label))}) for label, _ in samples]
        self.index = 0

    def get_next(self) -> dict[str, Any] | None:
        if self.index >= len(self.samples):
            return None
        sample = self.samples[self.index][1]
        self.index += 1
        return sample

    def rewind(self) -> None:
        self.index = 0


def pose_points(output: Any) -> Any:
    numpy_module = preprocessing.np
    heatmaps = numpy_module.asarray(output).reshape(output.shape[-3], -1)
    indices = numpy_module.argmax(heatmaps, axis=1)
    width = output.shape[-1]
    return numpy_module.column_stack((indices % width, indices // width))


def quality_evidence(
    source_model: Path,
    runtime_model: Path,
    fixtures: list[Path],
) -> dict[str, object]:
    load_dependencies()
    source = ort.InferenceSession(str(source_model), providers=["CPUExecutionProvider"])
    runtime = ort.InferenceSession(str(runtime_model), providers=["CPUExecutionProvider"])
    input_name = source.get_inputs()[0].name
    runtime_input_name = runtime.get_inputs()[0].name
    diagonal = math.hypot(64, 48)
    distances: list[float] = []
    exact = 0
    total = 0
    per_fixture: list[dict[str, object]] = []

    for fixture in fixtures:
        source_output = source.run(None, {input_name: preprocessing.image_input(fixture)})[0]
        runtime_output = runtime.run(None, {runtime_input_name: preprocessing.image_input(fixture)})[0]
        source_points = pose_points(source_output)
        runtime_points = pose_points(runtime_output)
        numpy_module = preprocessing.np
        displacement = numpy_module.linalg.norm(source_points - runtime_points, axis=1)
        normalized = displacement / diagonal * 100
        distances.extend(normalized.tolist())
        fixture_exact = int(numpy_module.count_nonzero(numpy_module.all(source_points == runtime_points, axis=1)))
        exact += fixture_exact
        total += source_points.shape[0]
        per_fixture.append({
            "fixture": fixture.as_posix(),
            "keypoints": int(source_points.shape[0]),
            "mean_normalized_argmax_displacement_percent": float(numpy_module.mean(normalized)),
            "p95_normalized_argmax_displacement_percent": float(numpy_module.percentile(normalized, 95)),
            "max_normalized_argmax_displacement_percent": float(numpy_module.max(normalized)),
            "exact_argmax_match_percent": fixture_exact / source_points.shape[0] * 100,
        })

    return {
        "fixtures": per_fixture,
        "samples": len(fixtures),
        "keypoints": total,
        "mean_normalized_argmax_displacement_percent": float(numpy_module.mean(distances)),
        "p95_normalized_argmax_displacement_percent": float(numpy_module.percentile(distances, 95)),
        "max_normalized_argmax_displacement_percent": float(numpy_module.max(distances)),
        "exact_argmax_match_percent": exact / total * 100,
    }


def assert_quality(evidence: dict[str, object]) -> None:
    if not (
        float(evidence["mean_normalized_argmax_displacement_percent"])
        <= MEAN_DISPLACEMENT_LIMIT_PERCENT
        and float(evidence["p95_normalized_argmax_displacement_percent"])
        <= P95_DISPLACEMENT_LIMIT_PERCENT
        and float(evidence["max_normalized_argmax_displacement_percent"])
        <= MAX_DISPLACEMENT_LIMIT_PERCENT
        and float(evidence["exact_argmax_match_percent"]) >= EXACT_MATCH_FLOOR_PERCENT
    ):
        raise RuntimeError(f"INT8 representative-fixture quality gate failed: {evidence}")


def source_lineage(source: Path) -> dict[str, object]:
    record_path = Path("docs/archive/ports/to-port-web-onnx/copy_manifest.json")
    record = json.loads(record_path.read_text())
    entry = next(
        item for item in record["entries"]
        if item["source"] == "models/onnx/pose_model.onnx"
    )
    actual_hash = sha256(source)
    actual_size = source.stat().st_size
    if entry["sha256"] != actual_hash or entry["size_bytes"] != actual_size:
        raise RuntimeError("FP32 source does not match the committed copy manifest lineage record")
    return {
        "record": record_path.as_posix(),
        "source": entry["source"],
        "sha256": entry["sha256"],
        "bytes": entry["size_bytes"],
    }


def model_manifest(
    source: Path,
    output: Path,
    calibration_fixtures: list[Path],
    evaluation_fixtures: list[Path],
    source_session: Any,
    evidence: dict[str, object],
    operation: str,
) -> dict[str, object]:
    source_size = source.stat().st_size
    candidate_size = output.stat().st_size
    shape = lambda values: ["batch_size" if value is None else value for value in values]
    generated = operation == "generated"
    return {
        "schema": "motionsmith.pose-model-int8.v3",
        "operation": operation,
        "source": {
            "path": source.as_posix(),
            "sha256": sha256(source),
            "bytes": source_size,
            "lineage": source_lineage(source),
            "opset": 11,
            "input": shape(source_session.get_inputs()[0].shape),
            "output": shape(source_session.get_outputs()[0].shape),
        },
        "calibration": {
            "kind": "representative-image-fixtures" if generated else "existing-candidate-calibration-unknown",
            "fixtures": [fixture.as_posix() for fixture in calibration_fixtures] if generated else [],
            "samples": len(calibration_fixtures) if generated else 0,
            "preprocess": "cleaned-foreground-bbox+20%-margin" if generated else "not-available-for-existing-candidate",
            "inputsAndProcessSpecified": generated,
            "artifactBitwiseReproduced": False,
            "historicalArtifact": None,
        },
        "evaluation": {
            "kind": "held-out-committed-fixtures",
            "fixtures": [fixture.as_posix() for fixture in evaluation_fixtures],
            "evaluationOnlyFixtures": [fixture.as_posix() for fixture in evaluation_fixtures],
            "samples": len(evaluation_fixtures),
            "preprocess": "cleaned-foreground-bbox+20%-margin",
        },
        "futureRecipe": {
            "generator": "scripts/quantize-pose-model.py",
            "calibrationFixtures": [fixture.as_posix() for fixture in calibration_fixtures],
            "evaluationFixtures": [fixture.as_posix() for fixture in evaluation_fixtures],
            "preprocess": "cleaned-foreground-bbox+20%-margin",
            "inputsAndProcessSpecified": True,
            "artifactBitwiseReproduced": False,
            "status": "applied-to-this-build" if generated else "recipe-only; existing candidate not regenerated",
        },
        "candidate": {
            "path": output.as_posix(),
            "format": "ORT",
            "status": "generated-not-deployed" if generated else "evaluation-only-existing-candidate",
            "deployed": False,
            "sha256": sha256(output),
            "bytes": candidate_size,
            "optimization": "basic",
            "sourceSizeRatio": candidate_size / source_size,
            "sizeReductionPercent": (1 - candidate_size / source_size) * 100,
        },
        "deployed": {
            "path": source.as_posix(),
            "format": "ONNX",
            "precision": "fp32",
            "sha256": sha256(source),
            "bytes": source_size,
        },
        "quantization": {
            "format": "QDQ",
            "activationType": "QInt8",
            "weightType": "QInt8",
            "perChannel": False,
            "calibrationMethod": "MinMax",
        },
        "quality": {
            "status": "measured-by-scripts/quantize-pose-model.py",
            "scope": "held-out evaluation fixtures only",
            "runner": "onnxruntime/CPUExecutionProvider",
            "evidence": evidence,
            "thresholds": {
                "meanNormalizedArgmaxDisplacementPercentMax": MEAN_DISPLACEMENT_LIMIT_PERCENT,
                "p95NormalizedArgmaxDisplacementPercentMax": P95_DISPLACEMENT_LIMIT_PERCENT,
                "maxNormalizedArgmaxDisplacementPercentMax": MAX_DISPLACEMENT_LIMIT_PERCENT,
                "exactArgmaxMatchPercentMin": EXACT_MATCH_FLOOR_PERCENT,
            },
        },
    }


def build(
    source: Path,
    output: Path,
    calibration_fixtures: list[Path],
    evaluation_fixtures: list[Path],
    quality_only: bool,
) -> dict[str, object]:
    overlap = set(calibration_fixtures) & set(evaluation_fixtures)
    if overlap:
        raise RuntimeError(f"Calibration and held-out evaluation fixtures must be disjoint: {sorted(overlap)}")
    if not evaluation_fixtures:
        raise RuntimeError("At least one held-out evaluation fixture is required")
    load_dependencies()
    source_session = ort.InferenceSession(str(source), providers=["CPUExecutionProvider"])
    input_name = source_session.get_inputs()[0].name
    fixture_samples = fixture_inputs(calibration_fixtures)

    if quality_only:
        evidence = quality_evidence(source, output, evaluation_fixtures)
        assert_quality(evidence)
        return model_manifest(
            source,
            output,
            calibration_fixtures,
            evaluation_fixtures,
            source_session,
            evidence,
            "quality-only",
        )

    calibration_reader = FixtureDataReader(fixture_samples, input_name)

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="motionsmith-pose-int8-") as temp_dir:
        quantized = Path(temp_dir) / "pose_model.int8.qdq.onnx"
        quantize_static(
            source,
            quantized,
            calibration_reader,
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
        ort.InferenceSession(str(quantized), options, providers=["CPUExecutionProvider"])

    evidence = quality_evidence(source, output, evaluation_fixtures)
    assert_quality(evidence)
    return model_manifest(
        source,
        output,
        calibration_fixtures,
        evaluation_fixtures,
        source_session,
        evidence,
        "generated",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("public/onnx/pose_model.onnx"))
    parser.add_argument("--output", type=Path, default=Path("models/candidates/pose_model.int8.ort"))
    parser.add_argument(
        "--calibration-fixtures",
        dest="calibration_fixtures",
        type=Path,
        nargs="+",
        default=[
            Path("tests/fixtures/stick-character.png"),
            Path("resources/examples/raw/girl.png"),
        ],
    )
    parser.add_argument(
        "--evaluation-fixtures",
        type=Path,
        nargs="+",
        default=[Path("resources/examples/raw/boy.PNG")],
        help="Committed held-out fixtures used for evaluation, not calibration.",
    )
    parser.add_argument(
        "--quality-only",
        action="store_true",
        help="Evaluate an existing candidate on held-out fixtures without claiming its calibration lineage.",
    )
    parser.add_argument(
        "--preprocess-contract",
        action="store_true",
        help="Emit executable foreground-crop preprocessing evidence for the fixtures.",
    )
    args = parser.parse_args()
    try:
        if args.preprocess_contract:
            preprocessing.load_dependencies()
            evidence = [preprocessing.contract_evidence(fixture) for fixture in args.calibration_fixtures]
            print(json.dumps({
                "schema": "motionsmith.pose-preprocess.v1",
                "policy": "cleaned-foreground-bbox+20%-margin",
                "fixtures": evidence,
            }, indent=2))
            return
        manifest = build(
            args.source,
            args.output,
            args.calibration_fixtures,
            args.evaluation_fixtures,
            args.quality_only,
        )
    except (QuantizerDependencyError, preprocessing.PreprocessingDependencyError) as error:
        parser.error(str(error))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
