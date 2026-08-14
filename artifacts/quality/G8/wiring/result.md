# G8 Sol wiring result

Source commit: `892e619`

Integrated verification commit: `ed4396ac490b82d6fa43d5912d7d01fbaf27a5cf`

## Accepted boundary

- `MOTIONSMITH_SUMMARY=1` is the only enable switch. Undefined or `0` is off;
  every other value is rejected.
- Enabled builds require an absolute credential-free HTTP(S) target and an
  actual 7–40 hexadecimal Git SHA. Neither value is sourced from `VITE_*`.
- The default production bundle contains no schema marker, endpoint, session
  adapter, error listener, request transport, or summary field names.
- The enabled browser owns one lazy session with coarse environment buckets,
  one normal best-effort flush at the first export boundary, and one bounded
  exit beacon. Transport failure cannot alter a product command result.
- Stable wiring observes stage changes, command outcomes, accepted mechanism
  families, Fit latency/outcome, export outcome/blocker, completed autosave
  writes/recovery, image-inference outcome/latency, and uncaught error names.
- Path pointer-frame commits, animation frames, rendering, project state,
  coordinates, files, names, messages, stacks, and persistent storage never
  enter the summary boundary.
- Autosave remains independently correct: its lifecycle imports no study
  module and receives no observer in the default build.

## Deciding evidence

- `raw-default-build.log`: default `tsc && vite build` plus negative dist scan,
  exit 0.
- `raw-enabled-build.log`: enabled build plus exact target/schema/build-SHA
  scans, historical-surface negative scan, and invalid-config refusal, exit 0.
- `raw-focused-tests.log`: G8 adapter/analyzer/wiring, G4 persistence, G5 ONNX,
  project contracts, and diff check, exit 0.
- The integrated production-preview return gate reran all eight formerly
  failing G7 cases with two workers: 8 passed in 59.6 seconds.

The mandated Orca telemetry off/on performance comparison remains a G9 final
gate; this result makes no latency or frame-overhead claim in advance of that
measurement.
