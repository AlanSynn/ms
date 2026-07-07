# Agent/LLM/Harness Audit (Task 3) — Worker-3
Date: 2026-07-07
Scope root: `/Users/alansynn/Documents/MechAnim`

## Sources consulted
- `/Users/alansynn/.codex/config.toml` (plugin enable block, lines 92-111)
- `omx list --json` (runtime skill registry snapshot)
- `/Users/alansynn/.omx-runs/run-20260704224954-e4fe/.omx/state/sessions/*/autopilot-state.json` (context snapshot refs)
- `/Users/alansynn/.codex/.tmp/marketplaces/ponytail/.codex-plugin/plugin.json`
- `/Users/alansynn/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/browser/.codex-plugin/plugin.json`
- `/Users/alansynn/.codex/plugins/cache/openai-primary-runtime/{documents,pdf,spreadsheets,presentations,template-creator}/26.630.12135/.codex-plugin/plugin.json`

## Findings

### 1) Installed/active skills + plugins
- Enabled plugins: `ponytail@ponytail`, `browser@openai-bundled`, `documents@openai-primary-runtime`, `pdf@openai-primary-runtime`, `spreadsheets@openai-primary-runtime`, `presentations@openai-primary-runtime`, `template-creator@openai-primary-runtime`.
- `omx list --json` snapshot: **50 skills total**, **28 active skills**, **20 active agents**.
- Active skills: `autopilot, ralph, ultrawork, team, ultraqa, autoresearch, autoresearch-goal, performance-goal, pipeline, ultragoal, plan, ralplan, deep-interview, prometheus-strict, best-practice-research, analyze, ai-slop-cleaner, code-review, visual-ralph, design, ask, cancel, doctor, wiki, skill, hud, omx-setup, configure-notifications`.
- Deprecated/low-priority: `ecomode, swarm, deepsearch, tdd, build-fix, security-review, visual-verdict, web-clone, frontend-ui-ux, review, ask-claude, ask-gemini, help, note, trace, ralph-init`.
- Active agents: `explore, analyst, planner, architect, debugger, executor, verifier, code-reviewer, dependency-expert, test-engineer, designer, writer, git-master, researcher, prometheus-strict-metis, prometheus-strict-momus, prometheus-strict-oracle, critic, scholastic, vision`.

### 2) Needed for coding this repo now
Needed now:
- `analyze`, `plan`, `ralplan`, `deep-interview`, `code-review`, `hud`, `doctor` + engineering agents (`explore`, `executor`, `debugger`, `dependency-expert`, `test-engineer`, `verifier`).
- Plugin `browser`.

Not needed this pass:
- Artifact plugins (`documents`, `pdf`, `spreadsheets`, `presentations`, `template-creator`), + deprecated workflow skills (`ask-claude`, `ask-gemini`, `help`, `note`, `trace`, etc.).

### 3) Lowest-risk disable candidates
- Disable deprecated skills first (already deprecated): `deepsearch`, `ecomode`, `tdd`, `build-fix`, `security-review`, `visual-verdict`, `web-clone`, `frontend-ui-ux`, `review`, `ask-claude`, `ask-gemini`, `help`, `note`, `trace`, `swarm`, `ralph-init`.
- Disable non-coding utility plugins if artifact output not in current local task: `documents`, `pdf`, `spreadsheets`, `presentations`, `template-creator`.

### 4) Non-repo context injection check
- No `/omx/context/state` path under repo `.omx/context`.
- `autopilot-state.json` snapshot paths resolve to repo-local files under `.omx/context/*.md` only, e.g. `planetary-foundry-playback-20260705T211322Z.md`, `foundry-overlay-stack-link-overrides-20260705T205500Z.md`, `image-1-onnx-agent-team-coresearch-coresearch-20260707T084630Z.md`.
- No non-repo absolute context path injection in session state.

## Risk note
Subagent fan-out not run — no observable native subagent invocation facility in this worker loop.