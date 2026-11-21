# CC-MAPPING-0-USER-001-006-BLOCKER-PRECISION-2026-09-19

## Status

CLOSED — RECONCILIATION VERIFIED

Closure basis:
- The authoritative B01-B03 source batch already contains the refined USER-001/USER-006 blocker wording in commit `42a98bb568adf0ebbe3410b19fef616019351a32`.
- Current Canonical Mapping on `main` retains explicit USER-001 API/Entity edges and USER-006 API edges without promoting either feature status.
- No DTO, Persistence, Payload, Code, Security, Lifecycle, Test, or Evidence Registry edge was inferred or promoted by this closure.
- This closure changes only blocker-text reconciliation state; Feature status remains fail-closed.

## Finding

The explicit USER-001/USER-006 evidence-bound delta has already materialized selected API/entity/policy edges into Canonical Mapping, but the source batch blocker wording was not updated with the newer evidence.

### USER-001

Verified in the existing delta:
- API: `getMe`, `updateMe`
- Entity: `ENT-USER`
- Fields: `username`, `displayName`, `bio`, `avatar`, `locale`, `timezone`

Current blocker text:
`B02 mapping not yet evidence-bound beyond Blueprint`

This is now stale as wording because explicit evidence-bound API/entity evidence exists.

### USER-006

Verified:
- API: `blockUser`, `unblockUser`, `muteUser`, `unmuteUser`
- Policy edges: self/permission boundary, idempotency, atomic convergence, cache invalidation/versioning, bounded async propagation, anti-abuse, audit

Still genuinely unestablished:
- feature-bound Entity/Field authority
- downstream DTO/persistence/Payload/code/security/lifecycle/test/Evidence closure
- executed integration/security evidence

Its current blocker remains directionally valid but is too broad.

## Required disposition

Refine blocker text in the authoritative source batch only after confirming the generator/reconciliation path, while preserving:

- feature status as `UNRESOLVED`;
- all fail-closed downstream gates;
- no inference of Entity/Field/Persistence for USER-006;
- no DTO edge invention.

Do not directly edit generated Canonical Mapping unless the authorized generator path is used.

## Evidence

`artifacts/mapping-0/user-001-006-blocker-precision-audit-2026-09-19.json`

No implementation authorization is granted.
