# Change Control — AUTH-003 Runtime / Persistence Admission Packet
## 2026-09-27

- Control ID: `CC-MAPPING-0-AUTH-003-RUNTIME-PERSISTENCE-ADMISSION-PACKET-2026-09-27`
- Status: `AUTHORITY INPUT REQUIRED / IMPLEMENTATION NOT AUTHORIZED`
- Source main: `1b3406860d88c12160513caa01fbc99cfbdc4507`
- Backup: `backup/pre-auth003-logical-ownership-reconcile-20260927`
- Machine packet: `artifacts/mapping-0/auth-003-runtime-persistence-admission-packet-2026-09-27.json`

## Purpose

Convert the remaining AUTH-003 runtime/persistence blockers into one executable admission packet. This packet does not choose missing policy values and does not invent physical schema names.

## Already frozen

- Four canonical operations and routes are unchanged.
- Self-scoped authorization and `user.credential.manage` / `user.credential.read` are unchanged.
- Mutations require `Idempotency-Key`.
- Normalization and uniqueness rules remain those already contracted.
- Public projection remains `credentialId`, `kind`, `active`.
- Credential values, normalized values, hashes and internal identity metadata remain non-public.

## Authority input A — Operation Policy

The following five dimensions remain unresolved for each of the four operations:

`resource`, `cache`, `retry`, `event`, `queue`, `antiAbuse`.

Each value must come from an explicit authority source or be explicitly declared `N/A` with rationale. The separate `user-account` operation policy is not currently bound to AUTH-003, so its values are not silently inherited. The historical `edge-first-worker-topology` resource defaults are explicitly superseded and are not admitted.

The machine packet enumerates the exact fields that must be supplied.

## Authority input B — Physical Persistence

The AUTH-003 mapping remains:

- `ENT-IDENTITY`
- `ENT-CREDENTIAL`

with:

- actual controlled D1 target identity;
- actual table names;
- actual column definitions;
- actual indexes;
- actual constraints / foreign keys;
- field-by-field mapping;
- migration history;
- `MIG-AUTH-003-CREDENTIAL-V1` execution evidence;
- exact tested commit SHA.

No physical identifier may be inferred from contracts, neighboring features, archived artifacts, or Payload conventions.

## Admission boundary

Until both authority inputs are admitted:

- runtime implementation = `NOT_AUTHORIZED`
- migration execution = `NOT_AUTHORIZED`
- entity promotion = `NOT_AUTHORIZED`
- Evidence Registry promotion = `NOT_AUTHORIZED`
- Mapping 0 GREEN = `NOT_AUTHORIZED`

## Next implementation slice after admission

Once both inputs exist, admit only the smallest AUTH-003 vertical slice first:

`authCredentialAdd` → persistence uniqueness boundary → idempotency → authorization/security-negative tests → durable evidence.

Do not implement all four operations as one unreviewable batch. Expand only after the first slice is reconciled and evidenced.

## Repetition guard

This control does not reopen AUTH-003 wire/OpenAPI/DTO work and does not rerun:

- W01 baseline migration `35508571153`;
- AUTH-002 E6 runtime `36219132123`.

Those remain inherited verified evidence.


## Logical ownership reconciliation — 2026-09-27

A separate authority reconciliation has now closed the logical ownership layer:

- AUTH-003 logical Worker = `W02`
- AUTH-003 logical D1 = `D1-01`
- Logical entities = `ENT-IDENTITY`, `ENT-CREDENTIAL`

The authority chain is the active Worker Master → Worker × D1 Binding → D1 Domain Master.

This does **not** close physical runtime binding. The repository still does not establish the physical Worker identity/configuration for W02, nor an AUTH-003 execution target that may be assigned to the existing W01 Payload D1 binding. The existing `luckread` inventory record is explicitly `W01-PAYLOAD-D1-BINDING` and remains excluded from reassignment by inference.

The AUTH-003 operation-policy resource/cache/retry/event/queue/anti-abuse authority remains unresolved.

The AUTH-003 task edge also remains unresolved; W02 owns T01/T02/T03, but no authoritative source currently binds AUTH-003 to one of those tasks.

Therefore the implementation gate is narrowed, not removed:
`logical owner CLOSED → physical binding + operation-policy authority REQUIRED → implementation admission`.
