# CC-MAPPING-0-AUTH-003-REPLACE-REMOVE-IMPLEMENTATION-ADMISSION-2026-09-27

Status: **IMPLEMENTATION SLICE ADMITTED / RUNTIME EVIDENCE REQUIRED**

## Scope

Admit only the next smallest AUTH-003 lifecycle implementation slice:

`authCredentialReplace + authCredentialRemove → normalization/verification boundary → persistence lifecycle transition → self-authorization/security evidence`

Current authoritative main at admission: `70ce8bafbcd9f39ceec1b80106b958a1543de326`.

This control intentionally does **not** reopen AUTH-003 wire/API/DTO authority, D1 schema authority, or the already-admitted credential-add slice.

## Existing authority carried forward

- Task edge: `AUTH-003 → T01 → W02 → D1-01`.
- Physical target: `luckread-w02 / workers/W02-content / D1-01 / luckread`.
- Replace: `PUT /auth/credentials/{credentialId}`.
- Remove: `DELETE /auth/credentials/{credentialId}`.
- Replace request: `value`; credential kind is immutable on replace.
- Replace success: 200 with public projection `credentialId, kind, active`.
- Remove success: 204 with no response body.
- Mutations require `Idempotency-Key`.
- Authorization: authenticated self scope with `user.credential.manage`.
- Public projection: `credentialId, kind, active`.
- Credential value, normalized value, hash, verification metadata and identity ownership data are non-public.
- Normalization:
  - username/email: trim → Unicode NFC → casefold;
  - phone: E.164 validation.
- Uniqueness authority: persistence boundary, scoped by `kind + normalizedValue`.
- Remove safety: must not retire the account's only active credential.
- Event/queue budget: zero.
- No shared cache, cross-Worker RPC, or outbound dependency.
- Payload native authentication/recovery remains the authentication substrate; AUTH-003 does not replace it.

## Admitted implementation boundary

The implementation may:

1. locate the selected credential only through authenticated self ownership;
2. validate and normalize the replacement value using the existing AUTH-003 credential primitives;
3. derive the protected credential hash through the existing application secret/key boundary;
4. preserve the selected credential kind during replacement;
5. update the authoritative `auth_credentials` row and clear verification state when the value changes;
6. rely on the existing composite uniqueness constraint as the authoritative replacement conflict boundary;
7. retire credentials by transitioning `active` from 1 to 0;
8. make removal concurrency-safe so the account cannot end with zero active credentials because of racing removals;
9. make replay of an already-applied lifecycle state harmless;
10. return no protected credential material in public results.

The implementation must not:

- add a new D1 table or migration;
- add an idempotency table, queue, cache, Worker or RPC;
- modify Payload native authentication/recovery;
- change AUTH-003 public routes, operationIds, DTOs, or wire schemas;
- change the admitted physical D1 mapping;
- promote ENT-IDENTITY or ENT-CREDENTIAL to GREEN;
- mark AUTH-003 or Mapping 0 GREEN.

## Evidence gate

Before lifecycle evidence is admitted, the same exact tested source SHA must prove:

- focused unit coverage for Replace/Remove;
- owned/self-scope authorization;
- cross-account access denied without mutation;
- normalization and protected-hash handling;
- uniqueness conflict is generic and does not disclose another account;
- Replace replay is harmless;
- Remove replay is harmless;
- only-active-credential removal is rejected;
- concurrent Remove has a single successful retirement at the persistence boundary;
- public Replace projection contains only `credentialId, kind, active`;
- Remove produces no public response body;
- synthetic remote rows are cleaned up;
- production Worker deployment remains false for the evidence harness.

Only after those executable inputs are registered may Replace/Remove lifecycle claims be admitted into the Evidence Registry and considered for Entity/Mapping promotion.

## Non-actions

This control does not authorize:

- remote migration re-execution;
- remote schema re-probe when an unchanged PASS_VERIFIED postcheck already exists;
- production Worker deployment;
- Entity catalog promotion;
- Mapping 0 GREEN promotion;
- reopening or rewriting historical AUTH-003 wire/API/DTO decisions.
