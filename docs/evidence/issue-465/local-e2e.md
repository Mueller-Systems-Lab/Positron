# Local E2E

Playwright now starts backend and Vite on dedicated ports 43100/45100, owns
their lifecycle, uses deterministic fake authentication, and sets
`reuseExistingServer=false`. Targeted lifecycle and route smoke validation:
11 passed. The full suite was interrupted after the targeted proof; full
release qualification remains open.
