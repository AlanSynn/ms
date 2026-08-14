# G9 QA return: G5 ONNX long-task failure

Disposition: nondeterministic host-contention failure; no product or test-contract fix.

## Question

Does `tests/browser/g5-web-onnx.spec.ts:123` expose a real UI-thread regression
on the accepted G5 source, or did the integration full-suite run classify a
host-contention task as an app regression?

## Evidence

- The exact reported command at `PLAYWRIGHT_PORT=43201` and
  `PLAYWRIGHT_WORKERS=2` passed once the integration process released the port:
  one test passed, both requests had `overlappingLongTasks=[]`, and the
  process-result count was 2.
- A one-worker production-preview run passed with empty overlap arrays for both
  requests.
- Two concurrent copies of the exact test (`--repeat-each=2`, two workers)
  both failed: the first overlap was 191ms and the second was 217ms.
- Two serial copies (`--repeat-each=2`, one worker) both passed with empty
  overlap arrays.
- In the failure, the app-owned result application lasted approximately 1ms;
  the observed 121ms/191ms/217ms tasks occurred after result application while
  another Playwright worker was active. The strict `>50ms` assertion therefore
  remains meaningful and was not weakened.

The fresh unfiltered runs reinforce the same disposition: isolated port 43215
passed with empty overlap arrays for both requests (`exit_code=0`); concurrent
port 43216 failed both copies (`exit_code=1`), with one copy recording a 144ms
first-request overlap and the other recording 245ms plus 64ms on its second
request. The app-owned result-application intervals in those raw records were
sub-millisecond to approximately 1ms; the larger tasks were outside that
application interval and arose only under concurrent browser-worker load.

The raw commands and stdout/exit codes are retained in this directory:

- `raw-g9-fresh-isolated.stdout-stderr.log` and
  `raw-g9-fresh-concurrent.stdout-stderr.log` are the deciding evidence. Each
  file contains the complete combined stdout/stderr stream emitted by the
  fresh command, including every JSON evidence line, Playwright assertion
  diagnostic, attachment line, final summary, and an appended exact
  `exit_code=` line.
- The earlier `raw-g9-*.log` files (without `fresh` and without the
  `stdout-stderr` suffix) are condensed/manual transcripts from the first
  return. They remain useful summaries only and are not the deciding raw
  evidence.

- `raw-g9-contention-43211.log` — exact test during the active integration
  worker load, failed with a 121ms overlap.
- `raw-g9-exact-43201.log` — exact reported command after contention ended,
  passed.
- `raw-g9-concurrent-repeat-43213.log` — controlled two-worker reproduction,
  both failed with 191ms/217ms overlaps.
- `raw-g9-serial-repeat-43214.log` — controlled one-worker comparison, both
  passed with empty overlap arrays.
- `raw-g9-build.log` — production build, exit code 0.
- `raw-g9-port-conflict.log` — initial exact-port attempt was blocked by the
  still-running integration preview; it was not treated as a test result.

## Recommendation

Keep the current long-task contract and production code unchanged. The
deciding G5 browser test should run in an isolated/serial worker lane when the
full suite is under CPU contention; do not replace the assertion with a larger
threshold, ignore overlapping tasks, or classify the full-suite failure as a
product regression. If the integration harness needs a code change, scope it
to worker scheduling/isolation outside this G5 source lane and preserve this
contract unchanged.

No telemetry/G9 files were touched. The only new files are G5 evidence under
`artifacts/quality/G5/g9-return/`.
