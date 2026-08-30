# Persistent lock validation

`cp_external_mutation_locks` is a single SQLite-backed authority with resource
key, owner, generation, acquire/expiry/renew timestamps and status. Atomic
acquire, renewal, release, expiry recovery and writer fencing are tested across
independent connections. Targeted tests: 3 passed. The adapter refuses push
without a valid lock and no second control plane was introduced.
