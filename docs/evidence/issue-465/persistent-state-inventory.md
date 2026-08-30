# Persistent-state inventory

SQLite control-plane tables (`runs`, `run_events`, `artifacts`, command results,
`cp_jobs`, `cp_attempts`, decisions, reconciliations, approvals, queue,
workspace/provider leases and `cp_external_mutation_locks`) are durable and
must be backed up. Runtime configuration is configuration/secret-bearing and
must be backed up separately without secret values. Logs and active processes
are ephemeral; derived build output is regenerable.
