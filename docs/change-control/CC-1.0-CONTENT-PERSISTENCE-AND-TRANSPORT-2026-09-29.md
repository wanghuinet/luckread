# CC-1.0-CONTENT-PERSISTENCE-AND-TRANSPORT-2026-09-29

- Status: **DECISION RECORDED / IMPLEMENTATION PRECONDITION**
- Main at decision input: `b5bafc270e322c51160185f4ac7a8977e5c0dc0b`
- Scope: close the two remaining 1.0 Content runtime preconditions identified by the Content Core wire/state decision.

## Decisions

1. **Logical persistence**: W03 writes authoritative Content state in D1-02 under binding `D1_02`. The physical Cloudflare database UUID/name is intentionally left unassigned until an authoritative resource inventory/physical-binding decision provides it.
2. **Schema**: the minimum Content/Article contract maps to `contents`; per-domain mutation idempotency uses `content_mutation_idempotency`; mutation side effects enter `content_outbox_events` in the same D1 transaction.
3. **Transport**: W01 remains the public boundary. W01 calls W03 over a Cloudflare Service Binding named `W03_CONTENT`; W03 exposes no public Content API.
4. **Principal**: W01 performs the existing public authentication boundary and forwards only a resolved user id as internal principal metadata. End-user Authorization credentials and Payload secrets are never forwarded to W03.
5. **Retry**: internal mutations are not automatically retried; public retries use the existing Idempotency-Key semantics.

## Explicit blockers

- D1-02 physical resource UUID/name is **NOT_YET_ASSIGNED** and must not be inferred from `luckread` or `luckreadpro`.
- W03 Cloudflare Worker physical deployment has not been evidenced.
- W01 `W03_CONTENT` binding deployment has not been evidenced.
- Migration execution is not authorized by this decision.
- Content runtime is still **BLOCKED_NOT_GREEN** until implementation and remote evidence gates pass.

## No topology expansion

This decision adds no Worker, no D1 and no Task. It only binds existing W03/D1-02 logical ownership and the W01 public boundary.
