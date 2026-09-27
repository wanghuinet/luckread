# Change Control — AUTH-003 Runtime / Persistence Admission Packet
## 2026-09-27

- Control ID: `CC-MAPPING-0-AUTH-003-RUNTIME-PERSISTENCE-ADMISSION-PACKET-2026-09-27`
- Status: `AUTHORITY INPUT REQUIRED / IMPLEMENTATION NOT AUTHORIZED`
- Source main: `6f23e53237286c8fdec5d078737d0340d61f794a8`
- Backup: `backup/pre-auth003-admission-packet-20260927`
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
