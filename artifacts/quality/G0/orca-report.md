# G0 Orca production-preview characterization

Baseline: `4f3f7cc4906c2fef49b5796c2c6e43988466b9d2`
Preview: production build served at `http://127.0.0.1:4187/` from the integration worktree
Orca runtime: 1.4.181, runtime id `5aa221c2-d1ac-4e04-b0a8-30e23faa79d1`

## Commands

```text
orca terminal create --worktree path:/Users/alansynn/orca/workspaces/MechAnim/quality-sol-max-integration --title G0-preview --command "bun run preview -- --host 127.0.0.1 --port 4187 --strictPort" --json
orca tab create --url http://127.0.0.1:4187/ --json
orca wait --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --load networkidle --json
orca snapshot --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --json
orca click --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --element @e4 --json
orca snapshot --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --json
orca click --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --element @e4 --json
orca snapshot --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --json
orca click --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --element @e5 --json
orca snapshot --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --json
orca click --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --element @e47 --json
orca snapshot --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --json
orca console --page 6906312c-1aa2-4f71-803b-c0f7aa104333 --limit 50 --json
```

## Observed behavior

- Startup reached the compact Getting Started dialog.
- Guide exposed four result-first lesson choices.
- `Make a hand wave` opened Character with the `Make it yours` ownership cluster, 14 editable parts, 17 joints, and the shared canvas.
- Path Editor opened with the existing editable path and motion target.
- Foundry opened with physical connection handles and one foreground Play control.
- Foundry also displayed reading-heavy explanation copy in the selected-item inspector; this conflicts with the project result-first copy contract and is routed to the owning UI lane.
- After clicking Foundry Play, subsequent Orca snapshot, console, and reload requests each failed to return within 30 seconds and ended with the same runtime error. Closing the browser tab remained responsive.

Raw repeated error:

```json
{
  "id": "local",
  "ok": false,
  "error": {
    "code": "runtime_unavailable",
    "message": "The Orca runtime closed the connection before responding. Restart Orca and try again."
  },
  "_meta": {
    "runtimeId": null
  }
}
```

This is baseline evidence, not yet proof of an application defect: G3 must reproduce it with an isolated Playwright performance probe and distinguish app main-thread starvation from an Orca browser-runtime fault.
