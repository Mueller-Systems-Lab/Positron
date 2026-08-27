# Transfer reconciliation evidence — Issue #455

## Identity and scope

| Field | Value |
| --- | --- |
| Old canonical repository | `xxammaxx/Positron` |
| New canonical repository | `Mueller-Systems-Lab/Positron` |
| Repository ID | `1244247902` |
| Old owner | `xxammaxx` |
| New owner | `Mueller-Systems-Lab` |
| Repository visibility | public |
| Default branch | `main` |
| Main before | `dad1ca89859c8aa11084214f180b84a0a4e8b6b0` |
| Pages before/current target | `https://mueller-systems-lab.github.io/Positron/` |
| Transfer issue | #455 |

The live Git reference returned the expected start SHA from both old and new
canonical URLs. The stable GitHub repository ID was read from the new-owner
repository object; no replacement repository was inferred.

## Reference policy

- Current canonical and operational Positron references now use
  `Mueller-Systems-Lab/Positron`.
- Current Pages metadata now uses
  `https://mueller-systems-lab.github.io/Positron/` and keeps the `/Positron/`
  project base path.
- Historical evidence, release/changelog records, dated snapshots, and
  historical sandbox targets retain their original owner and URLs.
- External current target projects such as `xxammaxx/VoiceWiki`,
  `xxammaxx/KleinPilot`, and the dedicated `xxammaxx/positron-sandbox` remain
  unchanged because they are not the transferred repository.
- `HISTORICAL_TRUTH_MUTATIONS = 0`.

Baseline inventory: [reference-inventory.md](reference-inventory.md).

## Updated current references

- README badge, repository links, Pages CTA, and clone URL.
- Contributing, status, architecture, governance, security, and install links.
- Current generated Positron links, production-repository safety guards,
  operational defaults, scripts, E2E fixtures, and tool-gateway fallback.
- GitHub Actions diagnostic link and agent-access regression target.
- Pages canonical/OG URL, GitHub CTAs, `robots.txt` sitemap, and `sitemap.xml`.
- `.opencode/config.json` machine-local path replaced with a workspace-relative
  path; reviewer identities, permissions, and model policy were not changed.
- `scripts/verify-transfer-references.mjs` scans current-facing allowlisted
  paths and intentionally excludes historical evidence and one historical
  snapshot fixture.

## Preserved historical references

The inventory records every baseline `xxammaxx` line and its classification.
Archived evidence, changelog/release material, historical diagnostics, old
run cards, historical sandbox references, external target repositories, and
synthetic fixtures were not mechanically rewritten. Representative protected
files include `docs/evidence/**`, `docs/changelog/**`, `docs/release/**`,
`docs/launch/post-v0.2.0.md`, and
`packages/shared/src/__tests__/github-snapshot-collector.test.ts`.

## Agent provenance

| Field | Result |
| --- | --- |
| Configured reviewers | 17 (from `.opencode/opencode.json`) |
| Executed reviewers | 16; `review-independent-final` blocked by controller runtime |
| Unique child sessions | 16 |
| Provider/model | `opencode/mimo-v2.5-free`; DeepSeek forbidden |
| Reviewer write/task/GitHub/push/merge authority | deny by configuration; confirmed in completed reviewer evidence |
| DeepSeek usage | 0 required |

## Validation ledger

| Gate | Result |
| --- | --- |
| `git diff --check` | PASS |
| Transfer regression | PASS (483 current-facing files; zero current stale refs) |
| Changed-path format/build/typecheck | PASS |
| Root/web/Vitest | PASS (132/2,632; 21/421) |
| Playwright/route smoke | PASS (35; 9) |
| Local Pages desktop/mobile | PASS; console 0, asset 404 0, overflow 0 |
| Link/secret/artifact scan | local checks PASS; remote link/CI pending |
| Fresh clone/quickstart | dry-run PASS; final proof pending |
| Required remote CI | pending |
| Pages build/deploy/live verification | pending until merge |

## Delivery ledger

| Field | Result |
| --- | --- |
| Branch | `positron/issue-455-organization-transfer-reconciliation` |
| PR | pending |
| Frozen head | pending |
| Merge commit | pending |
| Main after | pending |
| Issue #211 | closed / unchanged |
| Issue #308 | open / unchanged |
| Runtime behavior changes | 0 intended |

## Reviewer-runtime continuation

The continuation isolated the actual defect: the controller failed to invoke
the configured `review-independent-final` task. There was no evidence of a
reviewer permission denial. Current reviewer definitions were generalized to
consume active issue/PR context and no longer hard-code Issue #211 or the old
review PR range. The stable OpenCode command mechanism was added and statically
verified with `agent: review-independent-final`, `subtask: true`, and
`$ARGUMENTS`.

`opencode --version` returned `1.18.22`. The deterministic synthetic smoke
created a real child task with distinct parent/child session IDs and completed
read-only. Real fresh domain and final-review invocations then produced no
JSON event, task event, or child-session evidence before their bounded
timeouts, including a 90-second minimal provider probe. This is recorded as a
runtime block rather than a successful reviewer wave.

```text
CURRENT_REVIEWER_HARDCODED_OLD_ISSUE_IDS=0
CURRENT_REVIEWER_HARDCODED_OLD_PR_IDS=0
CONFIGURED_REVIEWERS=17
FRESH_REVIEWERS_EXECUTED=0
FRESH_UNIQUE_CHILD_SESSIONS=0
DETERMINISTIC_COMMAND_SMOKE=PASS
REAL_FINAL_REVIEW=BLOCKED_NO_STABLE_PROVIDER_EVENT
DEEPSEEK_AGENT_USAGE=0
```

The previous 16/17 reviewer evidence is preserved unchanged as historical
attempt evidence. Because the required fresh 17-review proof is absent, this
continuation cannot safely freeze, merge PR #456, deploy Pages, or close Issue
#455.
