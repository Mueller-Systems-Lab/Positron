# Restart and crash recovery

Existing durable attempt, queue and workspace-lock tests cover stale lease
recovery, fencing, completed-state immutability and idempotent replay. A
release-grade cross-process crash matrix covering provider reservations and
approval consumption is pending.
