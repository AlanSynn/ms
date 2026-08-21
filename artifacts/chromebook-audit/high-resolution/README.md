# High-resolution diagnostic evidence

These reports preserve the supplementary 2026-08-21 resolution comparison
used to set the Options boundary. They use instrumented WebGL clear submissions
from a local production preview at 1366×768 with CDP CPU throttling 6×.

- `metal-cpu6-comparison.json` compares Balanced DPR 1, High DPR 1, and High
  DPR 2 on ANGLE Metal with an Apple M1 Pro.
- `swiftshader-cpu6-comparison.json` compares Balanced DPR 1 and High DPR 2 on
  forced ANGLE SwiftShader.
- `swiftshader-high-dpr1-cpu6-comparison.json` records the separate High DPR 1
  SwiftShader stress sample.

These are diagnostic comparisons, not enforcing acceptance artifacts. They do
not contain a source revision or distribution hash, do not test a physical
Chromebook GPU, and do not establish a resource soak. The same-SHA release
evidence remains the schema-v2 Balanced reports in `../playback/`.
