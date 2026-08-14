# Unified Three baseline environment

Recorded before production edits on 2026-08-14T20:28:27Z (2026-08-14T16:28:27-0400 EDT).

## Source provenance

- Repository: `AlanSynn/ms`
- Protected checkout: `/Users/alansynn/Workspace/MechAnim`
- Branch: `main`
- `HEAD`: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`
- Fetched `origin/main`: `97e6b3b3ce6be2cc43699fd282687ff1a8cfc5af`
- Ahead/behind: `0/0`
- Leader checkout: `/Users/alansynn/Workspace/ms-wt/unified-three-sol`
- Leader branch: `perf/unified-three-sol`

The protected checkout had unknown pre-existing documentation work. It was not
cleaned, stashed, staged, or copied over:

- 74 tracked documentation files deleted, 16,556 deleted lines, no production-source changes.
- Tracked binary-diff SHA-256: `ac9aa2fd547cfbe29e5ded4c5abd8098c411d918a0e2a55e668d9667f378ffc3`.
- Porcelain-v2 status SHA-256: `78b295d18b795da3cd58cb4950d9b87ae5e3df5a38213a1f5900c032726c81d0`.
- Seven untracked planning files were present. Their hashes are recorded below.

| File | SHA-256 |
| --- | --- |
| `UNIFIED_THREE_AGENT_GOAL_PACK.md` | `c2700aa56e48a090b9972321c684869b00a9134d5d03705e56c2200f7455296a` |
| `UNIFIED_THREE_FIXED_VIEW_CHROMEBOOK_PLAN.md` | `534208e773dc1bbbcdd9cad8424f5c588b95162065c7a48009fcc2ea1cfb5250` |
| `UNIFIED_THREE_FIXED_VIEW_MASTER_GOAL.md` | `02fce3be2fb9f569b055af185021a9138d4e8c8cd5a47d044f9492fcb0926eaf` |
| `docs/ORCHESTRATED_QUALITY_PASS_PLAN.md` | `f47b16bcf62859ed9189254bca5b9295581c5d912f9ed6d6facaf3d37dc1d659` |
| `docs/goal-manifest.yaml` | `29fd520b7fa0d7b18b177c568931f234bf38d9f5cfc278d9da1dd5b07235d8f2` |
| `docs/tracking-thread.md` | `80eb058c1d2d643e2f392f3542305fd7736b7b7ff14d1ca94247a378cfa6aa3d` |
| `unified-three-fixed-view-manifest.yaml` | `a8e9badaef02871c14448fca8524d65ae1370fe06581d99cbb770f9b1c57914e` |

## Developer reference device

- Host: `COD-MBP16-LOAN2`
- OS: macOS 26.5.2 (Darwin 25.5.0, arm64)
- CPU: Apple M1 Pro
- Memory: 17,179,869,184 bytes (16 GiB)

This machine is neither required 4 GB Chromebook class. Its timings are
preflight and regression evidence only, never final device approval.

## Baseline gates

- `bun install --frozen-lockfile`: pass with Bun 1.3.14.
- `bun run test`: pass, exit 0, including the new export-byte golden.
- `VITE_BASE_PATH=/ms/ bun run build`: pass; main JS 1,584.88 kB, lazy Rapier JS 2,237.59 kB, lazy ONNX worker JS 238.07 kB.
- Existing release golden hashes cover `ProjectState`, mechanism snapshots,
  scene projection, low-level SVG/DXF, recipes, render plans, and fabrication
  stacks in `tests/project-contract.test.ts`.
- `tests/unified-three-export-byte-golden.test.ts` adds exact bytes and SHA-256
  gates for the four downloadable fabrication files, Assembly artifacts, and
  the existing Blueprint preview SVG before renderer extraction begins.

## Historical performance evidence at this source lineage

These are historical Orca production-preview measurements, not fresh A0 or
actual-Chromebook approval:

- G3 visible foreground sample: frame p50 8.4 ms, p95 50 ms, p99 50.9 ms;
  Foundry structural rebuild delta 0; maximum one WebGL clear per wrapped RAF.
- Final default/study comparison: default playback p95 86.5 ms and input p95
  43.0 ms. The historical report explicitly says the embedded browser ran near
  12 FPS and is not a representative Chromebook device benchmark.
- Default study transport requests after export/page-hide: 0 in the historical
  controlled run.

Fresh A0 audits must reproduce or contradict all runtime counters. Unknown
values remain unknown until measured; static call sites are not runtime counts.
