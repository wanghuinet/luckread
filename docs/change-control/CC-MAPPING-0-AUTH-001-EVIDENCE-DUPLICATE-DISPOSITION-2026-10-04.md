# Change Control — Mapping 0 AUTH-001 Evidence Deduplication — 2026-10-04

Status: CLOSED — DUPLICATE HISTORICAL EVIDENCE DISPOSITION

Baseline:
- authoritative main before this change: 91de8d0a662f34f18e94717e762ddc92babdb5a
- backup: backup/2026-10-04-pre-auth001-evidence-dedup
- working branch: chore/1.1-auth001-evidence-dedup

## Purpose

Reconcile three duplicate AUTH-001 executable PASS records that were left as `VERIFIED` with `EXACT_SHA` freshness but had no valid inheritance metadata.

This is a registry-admission hygiene change only.

## Records dispositioned

The following historical records remain immutable in provenance and PASS result, but their registry status is changed to `SUPERSEDED` because the same claim groups already contain admitted executable PASS evidence:

- `EVD-AUTH001-REGISTRATION-RUNTIME-LOCAL-002`
  - claim: `AUTH-001::REGISTRATION_D1_BATCH`
  - retained admitted claim evidence: `EVD-AUTH001-REGISTRATION-RUNTIME-LOCAL-ENV-POLICY-SPLIT-001`
- `EVD-AUTH001-REGISTRATION-SECURITY-LOCAL-002`
  - claim: `AUTH-001::PASSWORD_MATERIAL`
  - retained admitted claim evidence: `EVD-AUTH001-REGISTRATION-SECURITY-LOCAL-001`
- `EVD-AUTH001-REGISTRATION-CONCURRENCY-LOCAL-002`
  - claim: `AUTH-001::CONCURRENCY`
  - retained admitted claim evidence: `EVD-AUTH001-REGISTRATION-CONCURRENCY-LOCAL-001`

No record is marked GREEN.
No execution result, timestamp, sourceRef, commitSha, or provenance is rewritten.
The historical workflow artifact remains available for traceability.

## Basis

The canonical Evidence Registry fail-closed validator requires a current/inherited executable PASS for each claim group and separately rejects active stale PASS records without valid inheritance.

These three records were duplicate active PASS entries, while their claim groups already had executable VERIFIED/PASS evidence admitted under existing AUTH-001 Change Controls. Superseding the duplicates removes ambiguity without inventing a new mapping, changing runtime semantics, or rerunning an already-completed test.

## Scope exclusions

The following remain intentionally unresolved and are not changed by this control:

- `EVD-AUTH013-LIFECYCLE-MATRIX-REMOTE-001` remains an exact-SHA VERIFIED record requiring separate current evidence/inheritance review.
- AUTH-002 claim groups with only CREATED/EXPIRED PASS records remain blocked.
- Documentation-only PASS evidence remains insufficient.
- Global Mapping 0 remains `NOT_GREEN`.
- Global Evidence Registry remains `NOT_GREEN`.

## Validation

The modified registry must pass schema/structural admission checks and preserve the fail-closed status of all unresolved claim groups.

This change does not modify production Worker/D1 code, cache behavior, Contracts, Feature Inventory, or canonical Mapping relationships.
