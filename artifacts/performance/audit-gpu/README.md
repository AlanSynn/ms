# Chromebook GPU and context baseline

This directory is an external-only audit of baseline `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`. It does not modify app source or import audit code into the production bundle.

`runtime-headful-attempt-3.json` is the deciding successful production-preview run. It was headed Chrome at 1366×768, DPR 1, on an Apple M1 Pro developer machine. The page reported visible/focused, but macOS foreground verification timed out: headed foreground verification is incomplete, not visible-Orca approval. No Chromebook was available. Treat it as harness evidence, not Chromebook or foreground acceptance evidence.

Run the static scan:

```sh
node artifacts/performance/audit-gpu/static-gpu-audit.mjs artifacts/performance/audit-gpu/raw/static-source-audit.json
```

Build and host the production preview, then run the probe:

```sh
bun run build
bun run preview -- --host 127.0.0.1 --port 4173 --strictPort
MS_AUDIT_URL=http://127.0.0.1:4173 MS_AUDIT_RUN_ID=runtime-headful node artifacts/performance/audit-gpu/run-gpu-audit.mjs
```

The probe observes WebGL context creation, GL draw/clear calls, shader/program lifecycle calls, texture allocation estimates, DOM-exposed `renderer.info` samples, WebGL timer-query availability, and forced `WEBGL_lose_context` recovery. See [report.md](report.md) for the evidence boundaries and conclusions.
