# Mechanism binding hotfix

The reported `mech-...: choose target + path` text identifies an active mechanism without a connected motion path. It is a fabrication blocker, not an exception code. The student's original project is unavailable, so its exact editing sequence is unknown.

The previous Design template handler created an additional unbound mechanism when the selected path already had an owner. A template choice now prepares a replacement for that owner, keeps its ID and path, and commits the completed fit result. Without a playable selected path, it leaves the project unchanged. It also refuses a replacement that would discard another motion on a shared mechanism.

Selecting a mechanism selects its motion path. A later mechanism edit, selection change, path edit, or Undo cancels a pending template replacement before it can overwrite that state.

Inspection preserves Undo/Redo history. A new path fit updates the selected output's fit metadata, and a rejected fit remains a fabrication blocker after saving and reopening. Connecting a path and finding a buildable fit are separately verified.

Project loading and editing share binding reconciliation. Existing path ownership supplies the target when its saved mirror is stale. Disconnected mechanisms remain editable and are kept off until their connections are repaired. Blueprint exposes the affected mechanism and an action to reach its controls. Missing connections must never produce an active, apparently complete build.

The release retains version `0.0.16`. Earlier project versions remain local and portable; no hosted project storage is introduced.

Verification covers template ownership, legacy project reopening, geometry retention, blocked incomplete bindings, Undo/Redo, existing fabrication contracts, and production-preview file and Blueprint workflows. Commands and release results are recorded with the pull request.
