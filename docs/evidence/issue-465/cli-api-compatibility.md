# CLI/API compatibility

Stable CLI entry points are `health`, `runs`, `stats`, and `cancel`; adapter and
diagnostic commands remain experimental/internal. Stable HTTP surface includes
health, runs, repositories, evidence and settings projections. Existing route
and integration tests provide status/error-shape coverage; a versioned public
fixture contract is pending.
