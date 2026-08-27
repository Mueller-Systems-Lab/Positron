# Issue #211 — Independent OpenCode agent runtime

**Run date:** 2026-08-27  
**Repository HEAD at execution:** `81416e98a5e013a487d46b5d5a98b19856fb3a91`  
**CLI:** `opencode 1.18.22`  
**Upgrade:** not needed; no upgrade was performed  
**Stable/beta:** stable installed CLI; no beta/`opencode2` migration

| Capability | Result | Evidence |
| --- | --- | --- |
| `OPENCODE_VERSION` | `1.18.22` | `opencode --version` |
| `CONFIG_SCHEMA` | stable JSON schema URL with installed-generation `agent` / `permission` fields | `.opencode/opencode.json`, `opencode debug config` |
| `AGENT_MODE_SUPPORTED` | PASS; primary and subagent modes resolved | `opencode debug agent`, runtime task events |
| `TASK_PERMISSION_SUPPORTED` | PASS; controller allowlist and reviewer wildcard deny resolved | `opencode debug agent`, regression script |
| `AUTO_SUPPORTED` | PASS; `opencode run --auto` accepted | `opencode run --help`, controller runs |
| `JSON_EVENT_OUTPUT_SUPPORTED` | PASS; raw `step_start`, `tool_use`, `step_finish`, and `text` events emitted | `--format json` streams retained outside Git |
| `DEEPSEEK_AGENT_USAGE` | `0` | configured model scan and runtime manifest |

## Independence proof

The first controller session `ses_fbe2938abffeXMe7ceXzWB7gzN` launched 16 approved reviewer children through the real `task` tool. Every child has a distinct session ID and the same non-DeepSeek provider/model `opencode/mimo-v2.5-free`. A separate controller session `ses_fbe12e351ffeGJFm3bAkfZVB7y` launched the final verifier child `ses_fbe119745ffecn2msq3w2mBUFM` after all first-wave results were collected. The final child is distinct from both controller and every first-wave child.

The machine-readable session inventory is in `independent-reviews/runtime-manifest.md`. Raw event streams remain in `/tmp` only and are not committed; no hidden reasoning or credentials are included in repository evidence.

## Permission proof

- Reviewer `edit` and `write`: effective `deny`; write canary returned `DENIED` and `FILE_CREATED=NO`.
- Reviewer `task`: effective wildcard `deny`; nested-task canary returned `DENIED` and `TASK_DENIED=YES`.
- Reviewer GitHub mutation and shell permissions: effective deny by `github_*` and `bash` defaults; controller retains the explicit hard-deny matrix for `gh api`, merge/review/repo/workflow/secret/variable/release commands, push, and branch deletion.
- Controller task allowlist contains exactly the 17 approved Issue #211 reviewer IDs; built-in `build`, `plan`, `general`, and `explore` were discovered but not allowed or used.

Official references used for schema interpretation: [OpenCode agents](https://opencode.ai/docs/agents/), [OpenCode permissions](https://opencode.ai/docs/permissions), and [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
