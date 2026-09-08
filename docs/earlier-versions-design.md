# Earlier versions and safe restoration

Implemented locally on `feature/earlier-project-versions`, based on `d8c95f54f7cfb86d2f004cc9d64e3719227da1dd`. Verification and baseline failures are recorded in [earlier-versions-verification.md](earlier-versions-verification.md). The classroom scenario is a design requirement, not evidence about past failure causes or learning outcomes.

## Student workflow

Project provides **Earlier versions** and **Keep version**. Students can name a working state, continue editing, select an earlier state, play or scrub its actual motion, and choose **Restore**. Preview is read-only. **Back** or Escape returns to current work. Restoring first keeps the current state, so students can return to the state immediately before restoration.

Save Project carries current work and retained versions. Opening that exact file in a clean browser provides the included history. Older files open normally with no invented historical entries.

| Capability | Boundary |
| --- | --- |
| Undo/Redo | Existing session history: up to 40 entries / 8 MiB of exclusive state. Restore is one Undo operation. |
| Browser backup | Existing current/previous committed generations for explicit interruption recovery. |
| Earlier versions | New persistent historical snapshots, separately retained and acknowledged. |
| Save/Open Project | Portable current work and retained history, independent of the original browser. |
| Reset Lesson | The known lesson baseline, with a protected version of current work first. |

## Creation and retention

Automatic capture becomes due after 60 seconds when committed authored content has changed. A one-second poll schedules the existing idle boundary: a 120 ms timer followed by an idle callback with a 500 ms timeout. Ongoing editing does not restart this boundary. The request freezes the last committed state; later drag, path, artwork, or Foundry drafts cannot replace it. Foreground scheduling normally starts within 1.62 seconds of becoming due; browser suspension, a busy Worker, and unavailable storage can delay or prevent completion. Hidden-page notification attempts a due capture, but termination never guarantees persistence of the final edit.

Selection, tabs, camera, playback, import progress, and presentation preferences do not create versions. Existing gesture boundaries still own Undo grouping. Descriptions use changed object names or document branches such as joints, paths, or mechanisms.

| Limit | Policy |
| --- | --- |
| Per project history | 48 entries; 24 MiB of unique snapshot, asset, and entry payload |
| Browser history catalog | 16 branches; 96 MiB total payload |
| Individual expanded snapshot | 12 MiB |
| Portable file | 48 MiB; history must also satisfy its own limits |
| Immutable assets | At most 512 per archive |
| Automatic age | At most seven days; cleanup runs when capturing |

Database overhead and current/previous backup bytes are separate from these payload budgets. Device storage can be smaller. The panel reports the actual retained date range and distinguishes browser versions from history included in a downloaded file; it does not guarantee a fixed retention window.

Automatic sampling retains one state per minute for the newest ten minutes, then progressively coarser five-minute, fifteen-minute, hourly, and six-hour buckets. Further byte/count pressure removes crowded automatic samples first. Manual, pre-reset, pre-replacement, pre-restore, and restored records are protected from automatic pruning. If protected records fill the budget, capture fails visibly and offers file saving, explicit removal, and browser-history management.

Identical automatic content is deduplicated. Repeating the same manual name on identical latest manual content does not add an entry; a distinct name or reason preserves that explicit intent while sharing content bytes.

## Persistence, files, and authority

`ProjectState` remains the current document. `runtime/versions` owns a separate schema-1 archive of independently validated snapshot strings and SHA-256 addressed immutable images. Normalization excludes session selection, processing, presentation settings, revision noise, and derived exports. Snapshots never embed archives. Images are stored once per branch; cleanup considers every retained entry, including artwork deleted from current work.

Version records use `versions:` keys in the existing IndexedDB journal. Appending a snapshot, writing assets, updating the bounded metadata catalog, and pruning unused dependencies commit in one IndexedDB transaction. An abort rolls them back together. Browser backup, file download, and version retention have separate completion states; they are not one transaction. The UI only reports a kept version after transaction completion.

Each explicit file opening or starter choice gets a new local branch and writer owner. Imported history keeps its lineage but never merges with another file based on a matching name or project ID. Explicit backup recovery can claim that backup's branch. The latest accepted branch owns browser writes; delayed writes from an older tab or choice are rejected inside the transaction. Opened file contents remain authoritative regardless of a newer browser backup.

Save Project uses the schema-2 project envelope with a versioned history extension and shared current/historical images. The Worker validates the complete archive, schemas, references, sizes, checksums, and project identity, then reopens its own output to verify round-trip fidelity. Open validates the entire file before replacement. Paint commands, contours, joints, multiple paths, mechanisms, bindings, timing, and fabrication settings remain editable. Compatibility means older files open here; older applications are not promised to understand the extension.

History is never silently omitted. **Save current only** uses the existing ordinary download path. If opening a valid history file succeeds but browser initialization fails, its validated archive remains in memory for preview and file saving. Restore still requires successful durable preservation of current work. Retry can reinitialize storage. A failed history claim during backup recovery reports storage failure rather than claiming its history was recovered.

Storage management lists bounded metadata only. Deletion requires confirmation and an unchanged displayed catalog token. It deletes only that branch's history keys, preserving current/previous backup bodies and project files.

## Restore and interaction safety

Selection loads only the chosen snapshot and referenced assets. One existing Project viewer replaces the current viewer during preview, with a separate playback clock, scrubber, viewport, and camera. Rows have no WebGL viewers or thumbnail capture. Leaving preview releases its clock and renderer resources. Search only reveals the controls.

Restore revalidates the selected snapshot and assets, checks document/request identity, commits a protected pre-restore snapshot, checks again, then applies one pure Undoable update. Opening another file, editing, or canceling preview fences late results. The shared project decision boundary also invalidates older import/fitting requests. Failed pre-restore writes leave current work and the last committed backup unchanged. The historical source and newer entries remain. A separate protected restored record is written after React actually accepts the new state.

Current presentation preferences and camera are preserved. Authored settings restored are duration, timing profile, physics snap mode, friction, mass, fabrication-ready mode, and physical kit. Restoration clears derived exports, invalidates unusable mechanism fits, pauses playback, resets phase and Foundry draft state, and recomputes previews through existing domain contracts. Session Undo/Redo also preserves presentation preferences.

The client starts one lazy Worker, permits three outstanding requests, tracks each requested state through completion, and terminates after five idle seconds. It does not use a latest-value autosave queue for historical requests. Matching prepared autosave serialization can be reused. Encoding, hashing, validation, body reads, and retention scans run off-thread. No new serialization or persistence occurs in rendering, React updaters, pointer movement, or playback frames. UI chunks and explicit history action code load on demand to preserve existing bundle limits.

## Scope

Local files and browser storage only: no dependency additions, backend, account, analytics, image recognition, or thumbnail capture. No release note, version bump, push, or deployment is part of this feature. The separate robot hotfix was already merged and deployed at version `0.0.16`.
