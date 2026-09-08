# Gate implementation qualification

The repaired runner implements G10, G20, G25, G30, G35, G40, G50, G60, G65,
G70, G75, G80, G85, G90, G95, and G100 in the required order. Candidate
fingerprints hash deterministic path/type/mode/content records from tracked and
non-ignored candidates; ignored runtime state is excluded explicitly.

G40 records a preflight baseline, protects pre-existing user work, enforces
mutation prefixes, rejects generated/secret/dependency paths, and runs
`git diff --check`. G70 only validates read-only evidence. `.gates/commit.sh`
is the admitted commit path, and `.gates/finalize.sh` is the only source of
terminal project classifications.
