# G1 interface freeze

The following contracts are immutable inputs to G2, G3, and G8. A later lane may consume them but must not change acceptance policy.

## Edit command boundary

`resolveMechanismEditAttempt(project, previous, candidate, kit)` returns exactly one of:

- `{ status: "accepted", outcome: "accepted", mechanism }` for a complete accepted write;
- `{ status: "accepted", outcome: "no-op", mechanism: previous }` for a legal semantic no-op;
- `{ status: "rejected", outcome: "rejected", mechanism: previous, blocker, recoveryCandidates }` for a rejected edit.

Consumers must not dispatch for `outcome: "no-op"`. Rejection must not mutate project, history, generated path, export package, or preview input.

`resolveFabricationCandidate` preserves explicit physical selections, re-derives defaulted selections when geometry or placement changes, and accepts only complete compiler-ready state. Catalog inventory remains authoritative.

## Physical candidate boundary

`mechanismPhysicalConnectionCandidates` is the advertised catalog candidate set. `resolveMechanismPhysicalSelectionAttempt` applies the same raw-safety, preview-readiness, and compiler-backing preflight. Every advertised candidate must also pass `resolveMechanismCandidateCommit` without changing its connection identity.

G2 may consume accepted complete configurations. It must not edit G1-owned authority files or silently move invalid imported geometry.

## Frame boundary for G3

On structural changes, memoize by immutable mechanism plus physical kit:

- `prepareMechanismKinematics(mechanism, kit)`;
- `mechanismPhysicalConnectionCandidates(mechanism, state, kit)` when connection handles are visible;
- the prepared physical connections already returned by `PreparedMechanismKinematics`.

On ordinary frames use only:

- `calculatePreparedLinkage(prepared, phase)`;
- `preparedCamFollowerConstraintError(prepared, state)`;
- `projectMechanismConnectionHoleCandidates(state, preparedCandidates)`;
- `connectionSelectionSceneCoordinatesForPhysicalConnections(prepared.physicalConnections.connections, state)`;
- `resolveFourBarLinkageBlankPosesFromPhysicalConnections(prepared.physicalConnections.connections, state)`.

G3 must runtime-count zero catalog enumeration, compilation, connection normalization, and physical-connection resolution during ordinary playback frames. It must keep one foreground playback driver and use Orca production preview for the deciding Foundry Play flow.

## Telemetry boundary for G8

G8 may classify bounded command-summary counters from `outcome`. It must not alter the result type, restore action streams/replay/snapshots, or place any study telemetry in the default build.
