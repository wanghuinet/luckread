# CC-MAPPING-0-AUTH-013-PUBLIC-HTTP-E2E-ACTOR-TARGET-ISOLATION-2026-09-29

## Status

`APPROVED_FOR_EVIDENCE_TOOLING_ALIGNMENT`

## Trigger

Controlled AUTH-013 public HTTP E2E Run `36502416941` executed the exact deployed source
`f4c329b74f7110af76c7ba7339bfd9d3cb81f910`.

The run passed deployment provenance, Payload baseline admission, isolated fixture
creation, authentication/authorization assertions, the authorized 200 response
shape, and cleanup. It failed only at the stale `If-Match` assertion:

- expected HTTP `412 PRECONDITION_FAILED`;
- observed HTTP `401 UNAUTHENTICATED`.

The failure occurred because the prior successful transition changed the same
operator account used as the request principal from `ACTIVE` to `RESTRICTED`.
The following request was therefore denied by the authentication boundary before
the stale-version check could exercise the intended 412 path.

## Decision

Correct the evidence fixture and probe so the security principal performing the
transition is distinct from the target account.

The controlled fixture now contains:

- one basic principal with a Payload-native session;
- one operator principal with a Payload-native session and operator role;
- one independent target user with no principal/session role.

The public transport assertions therefore exercise:

1. unauthenticated denial against the target;
2. mandatory `If-Match` using the operator principal against the target;
3. lower-layer/client-authority injection denial using the basic principal;
4. authorized operator transition `ACTIVE -> RESTRICTED` on the independent target;
5. stale `If-Match` against that same target using the still-`ACTIVE` operator principal;
6. revoked-session denial using the basic principal, whose own account remains `ACTIVE`;
7. authoritative D1 state/journal/session assertions and complete fixture cleanup.

## Scope

This is evidence tooling only.

No change is made to:

- Contract/OpenAPI;
- W01 runtime behavior;
- W02 business logic;
- D1 schema;
- Payload version;
- Worker topology;
- Service Binding topology;
- authorization rules;
- Evidence Registry promotion.

## Change control

- Backup: `backup/pre-auth013-e2e-target-isolation-20260929`
- Working branch: `fix/auth013-e2e-actor-target-isolation-20260929`
- Trigger run: `36502416941`
- Exact deployed source under test: `f4c329b74f7110af76c7ba7339bfd9d3cb81f910`

## Admission boundary

The correction does not admit AUTH-013 as GREEN. A fresh controlled E2E run
against the already deployed source must complete successfully before any
evidence promotion or Mapping 0 closure decision.
