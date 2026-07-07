# Current AI / ML / ONNX usage map

## Runtime ONNX image-processing pipeline

- `repo/src/automataii/domain/animation/image_to_annotations.py`
  - Loads ONNXRuntime (`onnxruntime.InferenceSession`).
  - Required runtime model: `repo/models/onnx/pose_model.onnx`.
  - Optional detector path support exists, but current default disables detector inference, uses full-image detection cause `detector_backbone.onnx` is backbone-only artifact.
  - Uses OpenCV/NumPy/SciPy to preprocess images, run pose inference, build masks, write `char_cfg.yaml`, `mask.png`, `texture.png`, overlays, bounding boxes.
- `repo/models/onnx/pose_model.onnx`
  - Main pose-estimation model used at runtime.
- `repo/models/onnx/detector_backbone.onnx`
  - Bundled model artifact, packaging requirement; not used by default runtime detection unless explicitly passed.
- `repo/models/onnx/test_onnx_inference.py`
  - Local ONNX inference probe/reference script.

## Runtime body-part segmentation after pose inference

- `repo/src/automataii/domain/animation/body_parts_extractor.py`
  - Skeleton-driven segmentation and body-part extraction.
  - Uses OpenCV, NumPy, SciPy distance/filters, configured body part definitions.
- `repo/src/automataii/domain/animation/part_definitions.py`
  - Semantic body-part/joint map used by segmentation.
- `repo/src/automataii/domain/animation/skeleton_payload.py`
  - Normalizes generated skeleton payloads.
- `repo/src/automataii/domain/animation/templates.py`
  - HTML/debug templates for extracted parts.
- `repo/src/automataii/domain/animation/components/influence_map_generator.py`
  - Vectorized influence-map helper for segmentation-style operations.

## Computer-vision support, not neural inference

- `repo/src/automataii/domain/generation/contour/extractor.py`
  - OpenCV contour extraction from alpha masks/images for manufacturing contours.
- `repo/src/automataii/domain/generation/contour/models.py`
  - Contour data model.
- `repo/src/automataii/presentation/qt/interactive_segmentation_editor.py`
  - Manual segmentation editor using OpenCV/NumPy; no neural model.

## UI and app entry points that call the AI/CV pipeline

- `repo/src/automataii/presentation/qt/tabs/image_processing_tab.py`
  - Main GUI surface. Calls `image_to_annotations(...)`, then `BodyPartsExtractor.process()`.
- `repo/src/automataii/presentation/qt/tabs/image_processing/`
  - Extracted Image Processing tab helpers.
- `repo/src/automataii/presentation/qt/image_view.py`
  - Skeleton/image display used by image-processing UI.
- `repo/src/automataii/presentation/qt/dialogs/camera_dialog.py`
  - Camera input surface before image processing.
- `repo/src/automataii/presentation/qt/widgets/processing_steps_group.py`
  - Image-processing progress UI.
- `repo/src/automataii/application/project/adapters/image_processing.py`
  - Bridges generated parts/skeleton into app state.

## Automation, packaging, and verification

- `repo/src/automataii/scenarios/image_processing.py`
  - Headless image-processing scenario: ONNX annotations -> body part extraction -> manifest/metrics.
- `repo/src/automataii/__main__.py`
  - CLI entry point for `--scenario image-processing`.
- `repo/scripts/verify_onnx_models.py`
  - Validates ONNX model integrity when `onnx` package available.
- `repo/packaging/pyinstaller/automataii.spec`
  - Bundles `models/onnx` and ONNXRuntime native libraries.
- `repo/scripts/build_windows.py`
  - Verifies packaged ONNX model files and ONNXRuntime native binaries.
- `repo/scripts/build_macos.py`
  - macOS packaging context.

## Optional / legacy / development-only AI

- `repo/src/automataii/utils/model_downloader.py`
  - Optional legacy PyTorch model downloader metadata; runtime now uses bundled ONNX models.
- `repo/models/configs/`
  - Legacy MMDetection/MMPose-style model configs.
- `repo/models/pytorch/process_legacy_api.py`
  - Legacy PyTorch API processing script.
- `repo/models/test_complete_legacy.py`
  - Legacy PyTorch-to-ONNX comparison smoke.
- `repo/scripts/semantic_analyzer.py`
  - Development analysis tool. Uses TF-IDF by default, can use `sentence-transformers/all-MiniLM-L6-v2`; that model not stored in repo, would be downloaded/cached externally if used.

## Current Python dependencies involved

Declared in `repo/pyproject.toml` / pinned in `repo/uv.lock`:

- `onnxruntime` — runtime inference.
- `opencv-python` — image preprocessing, masks, contour extraction, manual segmentation.
- `numpy` — tensor and geometry arrays.
- `scipy` — filters and distance computations.
- `pillow` — fallback/image utilities.
- `pyyaml` — generated skeleton/config payloads.

No OpenAI/Anthropic/LLM API calls in app runtime. Only neural runtime path in app is local ONNX image-processing pipeline.