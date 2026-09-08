# Candidate-content fingerprint evidence

The fingerprint is an aggregate SHA-256 over sorted per-candidate records:
repository-relative path, file kind, filesystem mode, and content/symlink-target
SHA-256. It includes tracked content, new non-ignored content, deletions, and
relevant executable/mode changes, independent of staged versus unstaged state.

Self-test controls T08–T13 prove that changing tracked bytes, existing or new
untracked candidates, or versioned Evidence invalidates prior validation and
that the commit path rejects content different from G75.
