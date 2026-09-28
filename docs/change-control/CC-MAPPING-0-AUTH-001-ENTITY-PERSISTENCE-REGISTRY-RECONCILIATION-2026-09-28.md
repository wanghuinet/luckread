# CC-MAPPING-0-AUTH-001-ENTITY-PERSISTENCE-REGISTRY-RECONCILIATION-2026-09-28

## Status

`RECONCILED / BLOCKED_NOT_GREEN`

## Scope

Register the already evidenced AUTH-001 Feature→Entity→Persistence ownership in the canonical registry. This change does not promote AUTH-001, ENT-USER, ENT-CONSENT, ENT-IDENTITY, ENT-CREDENTIAL, Mapping 0, or the Evidence Registry to GREEN.

## Base

- main source head reviewed: `35637e9b41187989361bf36af55342db1a4a28bd`
- backup branch: `backup/pre-auth001-entity-persistence-registry-20260928`
- work branch: `reconcile/auth001-entity-persistence-registry-20260928`

## Admitted mapping inputs

1. `workers/W01-payload/src/collections/Users.ts` — Payload-native User/auth boundary.
2. `contracts/persistence/AUTH-001-registration-envelope-contract.v1.json` — registration envelope transaction and `ENT-CONSENT.id` binding.
3. `docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-ENVELOPE-WRITER-BOUNDARY-2026-09-27.md` — W01 User + envelope + consent transaction and W02/D1-01 eventual Identity/Credential materialization boundary.
4. `docs/change-control/CC-MAPPING-0-AUTH-001-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-27.md` — admitted development runtime boundary and explicit non-authorizations.
5. Controlled runtime evidence: `36372326548`, exact tested source `b357ebe74f480f00c72f8fb0606226348570c105`, admitted separately by the Evidence Registry governance path.

## Canonical mapping

AUTH-001 is now represented in the Feature Entity Persistence Registry with:

- domain: `D1-01`;
- entities: `ENT-USER`, `ENT-CONSENT`, `ENT-IDENTITY`, `ENT-CREDENTIAL`;
- persistence mode: `MIXED`;
- logical owner: `D1-01`;
- status: `BLOCKED`.

The registry entry is a binding record, not a verification claim. ENT-IDENTITY and ENT-CREDENTIAL remain proposed/blocking dependencies for promotion.

## Why this is admissible now

The previous omission was based on an unresolved ownership/persistence boundary. That boundary is now explicitly reconciled: W01 commits the Payload-native registration User, registration envelope, and consent atomically; W02/D1-01 owns eventual Identity/Credential materialization. No distributed transaction, new Worker, new D1, generic idempotency platform, or Payload Core fork is introduced.

## Remaining blockers

- Production PRIV-004 legal/compliance policy authority is not admitted.
- AUTH-001 controlled evidence is development-only and remains a separate promotion gate.
- Physical persistence/migration evidence for the concrete collections is not promoted by this registry entry.
- ENT-IDENTITY / ENT-CREDENTIAL overall entity promotion remains blocked.
- Mapping 0 / Five-Way / Strict R4 remain NOT_GREEN.

## Non-actions

- No runtime rerun.
- No production deployment.
- No new D1 migration.
- No schema invention.
- No Evidence Registry GREEN change.
- No global Mapping 0 status change.

## Result

This change closes only the previously missing AUTH-001 registry binding record. It preserves fail-closed status and existing evidence provenance.
