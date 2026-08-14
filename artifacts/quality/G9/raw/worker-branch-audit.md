# Worker branch audit

Audited against `quality/sol-max-integration` at
`0707c38aaf2ddc121cdfc550a2067812354b0123`.

`git cherry` classified every committed worker change as patch-equivalent to an
integrated commit except `90e9957` on `quality/luna-ai`. Inspection of that
commit found only these G5 evidence files:

- `artifacts/quality/G5/changed-files.txt`
- `artifacts/quality/G5/result.md`
- `artifacts/quality/G5/tests.txt`

It contains no production or test change and is superseded by the later G5
return evidence integrated as `345ed1f` and `1098ebf`.

| Branch | Audit result |
| --- | --- |
| `quality/luna-board` | All commits patch-equivalent/integrated. |
| `quality/luna-preview` | All commits patch-equivalent/integrated. Five untracked raw G3 logs were copied byte-for-byte into this final evidence commit. |
| `quality/luna-preview-g9` | All commits patch-equivalent/integrated. |
| `quality/luna-persistence` | All commits patch-equivalent/integrated. |
| `quality/luna-ai` | Source commits integrated; unmatched `90e9957` is superseded evidence-only. |
| `quality/luna-ai-g9` | All commits patch-equivalent/integrated. |
| `quality/luna-release` | All commits patch-equivalent/integrated. |
| `quality/luna-qa` | No branch-only commit. Its 22 untracked files are limited to G7 artifacts and two browser-test drafts; all 22 paths exist in integration, where the 10 differing drafts are superseded by the reviewed recovery versions. No production file is present. |
| `AlanSynn/luna-qa-recovery` | Both commits patch-equivalent/integrated; this is the committed recovery of G7 QA evidence/tests. |
| `quality/luna-telemetry` | All commits patch-equivalent/integrated. |

The audit did not delete or mutate worker-worktree leftovers. It establishes
that no worker branch or untracked worker file contains an unreviewed
production change.
