# G5 G9 return

Status: PASS for the two stale production-preview assertions returned by Sol.

The package-review test now records both sides of the pending-import contract:
the review metadata reports one package part while the canonical Character
Three canvas remains the original guided 14-part project. After `Use it`, the
committed project and canvas are explicitly asserted at one part.

The startup test now holds the hashed production entry module
(`/assets/index-<hash>.js`) before React mounts. It verifies the static loader
contains MotionSmith and the package version, with no AI/model progress copy.
It then releases the entry module while a separate ONNX route remains pending,
and proves the loader is removed and Character, Getting Started, and its
starter gallery are usable while the ONNX route is still unreleased. The ONNX
route is released before the existing session opt-out and reload assertions.

No production or configuration files were changed. The final scope is the two
requested test bodies plus this evidence directory. Orca embedded-browser
automation was not invoked; the deciding browser gate ran against the local
production preview on isolated port 57819.

## Evidence

- `raw-focused-production-preview.log`: exact focused browser command/output,
  exit code 0, two passed tests.
- `raw-build.log`: production build, exit code 0.
- `raw-tsc.log`: TypeScript check, exit code 0.
- `raw-contract.log`: project contract check, exit code 0.
- `raw-diff-check.log`: whitespace check, exit code 0.
