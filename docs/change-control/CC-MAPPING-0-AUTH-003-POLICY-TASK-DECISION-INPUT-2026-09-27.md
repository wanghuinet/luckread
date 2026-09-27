# CC-MAPPING-0-AUTH-003-POLICY-TASK-DECISION-INPUT-2026-09-27

Status: **DECISION-MATERIAL-READY / NOT_AUTHORIZED / NOT_GREEN**

## Scope

This Change Control records the prepared decision material for the two remaining AUTH-003 admission inputs:

1. Feature → Contract Task edge;
2. AUTH-003 Operation Policy resource/cache/retry/event/queue/anti-abuse fields.

## Decision material

Primary input:
`docs/decisions/2026-09-27-auth003-policy-and-task-edge-decision-input.md`

Machine artifact:
`artifacts/mapping-0/auth-003-policy-task-decision-input-2026-09-27.json`

### Candidate Task edge

`AUTH-003 → T01 → W02 → D1-01`

Basis: AUTH-003 is credential lifecycle management inside the Identity / Account boundary. The candidate is recorded as a fit assessment only; the canonical Mapping does not yet contain an explicit AUTH-003 → T01 edge.

### Proposed Operation Policy profile

A minimal cost-first profile is recorded for admission review:

- authorization-bound credential reads/writes use `NO_STORE`;
- authoritative mutations use `SINGLE_AUTHORITATIVE_WRITE`;
- bounded D1 budgets;
- no synchronous Worker-to-Worker RPC or outbound dependency without an explicit contract;
- one-attempt retry budget for the idempotent mutation surface;
- anti-abuse required on credential-management mutations;
- event/queue values remain unresolved where no AUTH-003 event/task contract exists.

The exact proposal is not canonical authority.

## Explicit non-actions

This control does not:

- modify `contracts/api/auth-operation-policy.v1.json`;
- modify the canonical Feature → Task → Worker → D1 Mapping;
- promote T01 ownership;
- promote ENT-IDENTITY or ENT-CREDENTIAL;
- create or execute a migration;
- create runtime handlers;
- create Evidence Registry PASS;
- promote Mapping 0 GREEN.

## Admission dependency

Before runtime implementation, a dedicated authoritative decision must admit/reject the candidate task edge and Operation Policy profile. The D1-01 read-only schema evidence gate is independent and must also be captured/reviewed.

## Current status

AUTH-003 remains:

`BLOCKED_RUNTIME_PERSISTENCE_IMPLEMENTATION_ADMISSION_REQUIRED`

The repository now has durable, reviewable decision material rather than an open-ended discovery loop.
