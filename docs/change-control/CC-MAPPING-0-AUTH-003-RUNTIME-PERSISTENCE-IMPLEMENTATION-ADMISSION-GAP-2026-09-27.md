# Change Control — AUTH-003 Runtime / Persistence Implementation Admission Gap
## 2026-09-27

- Control ID: `CC-MAPPING-0-AUTH-003-RUNTIME-PERSISTENCE-IMPLEMENTATION-ADMISSION-GAP-2026-09-27`
- Scope: AUTH-003 runtime/persistence admission preflight under existing contracts
- Status: `ADMISSION GAP REGISTERED / IMPLEMENTATION NOT AUTHORIZED`
- Source main: `b65ccc2873418367f372b4b3adf8101af0fbb54e`
- Backup: `backup/pre-auth003-runtime-persistence-batch-20260927`

## Established authority carried forward

The following are already frozen and are not reopened by this control:

- Operations: `authCredentialList`, `authCredentialAdd`, `authCredentialReplace`, `authCredentialRemove`.
- Routes: `/auth/credentials` and `/auth/credentials/{credentialId}`.
- Public credential projection: `credentialId`, `kind`, `active`.
- Add request: `kind`, `value`; replace request: `value`; credential kind is immutable on replace.
- List semantics: cursor + limit, default 50, max 100, `createdAt DESC, credentialId DESC`.
- Success semantics: list 200, add 201, replace 200, remove 204.
- Authentication/authorization: authenticated self-scope; mutating operations require `Idempotency-Key`.
- Credential material, normalized values and hashes are never public.
- Normalization: username/email = trim → Unicode NFC → casefold; phone = E.164 parse/validation.
- Uniqueness authority: persistence boundary, scoped by kind + normalizedValue; concurrent insert must resolve to one authoritative owner.
- Entity contracts: `ENT-IDENTITY` and `ENT-CREDENTIAL` remain proposed/contract-only.

## Admission blockers found at current main

### 1. Operation-policy authority is incomplete

`contracts/api/auth-operation-policy.v1.json` contains the AUTH-003 operations, but resource/D1, cache, retry, event, queue and anti-abuse budgets remain missing for the credential-management operations.

The existing AUTH-003 wire-authority Change Control explicitly records that no separate authority was found for these values. No neighboring operation values are copied by this control.

### 2. Physical D1 schema authority is incomplete

`contracts/alignment/mapping-batches/AUTH-002-006-d1-schema-mapping.v1.json#AUTH-003` remains `PENDING_SCHEMA_EVIDENCE` for physical table IDs, column mappings, indexes and constraints.

The migration manifest defines `MIG-AUTH-003-CREDENTIAL-V1` postconditions and checks, but it does not authorize guessed physical names.

Therefore:
- no table name is inferred;
- no column name is promoted from prose;
- no index or constraint is invented;
- no migration file is created or executed by this control.

### 3. Current W01 Payload implementation does not establish AUTH-003 entities

The current W01 Payload Users collection is the verified `ENT-USER` implementation. It does not establish the separate `ENT-IDENTITY` / `ENT-CREDENTIAL` runtime or persistence model required by AUTH-003.

There is no admitted AUTH-003 runtime implementation or migration reference on current `main`.

This control therefore does not add a parallel credential system merely to satisfy the mapping row.

### 4. Evidence execution path is not yet admitted

The AUTH-003 contracts require executable evidence for:
- real D1 schema/migration;
- normalization and uniqueness, including concurrency;
- enumeration resistance and generic conflict semantics;
- cross-account authorization denial;
- secret/non-public projection safety;
- integration/runtime behavior;
- final Evidence Registry binding at one exact tested commit SHA.

No Evidence Registry promotion is performed here.

## Admission decision

`implementationAuthorization = false`

`migrationExecution = false`

`runtimeEvidenceAdmission = false`

`entityPromotion = false`

`mapping0Promotion = false`

Implementation may proceed only after explicit authority closes the operation-policy fields and the physical persistence mapping without inference, followed by the implementation/evidence Change Control for the admitted scope.

## Smallest next governed batch

1. Resolve AUTH-003 operation-policy authority fields with explicit values or explicit N/A.
2. Resolve field-to-physical persistence mapping for `ENT-IDENTITY` / `ENT-CREDENTIAL` with actual schema authority; do not guess names.
3. Then admit the smallest implementation slice and its executable evidence workflow under the same tested SHA.
4. Only after evidence is registered may Mapping 0/R4 promotion be reconsidered.

No AUTH-002 rerun, W01 baseline rerun, AUTH-003 wire reopening, entity promotion, or GREEN promotion is authorized by this control.
