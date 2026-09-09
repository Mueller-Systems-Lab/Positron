# Issue #502 Plan

1. Record the effective Nginx image digest, image user, entrypoint, startup failure, and least-privilege variant matrix.
2. Review the proposed numeric runtime identity and tmpfs ownership against the current image and Compose topology.
3. Apply the narrow runtime-user/tmpfs contract to both Compose files.
4. Add an executable regression canary that validates security and startup invariants, including restart and HTTP readiness.
5. Run architecture, security, and product/operability reviews before implementation and again after the diff is complete.
6. Execute focused Docker checks, repository checks, and the complete supervised-stack qualification where the local environment permits.
7. Record exact evidence in Issue #502 and the migration evidence portfolio.
