# Mapping-0 AUTH Residual Blocker Register

Date: 2026-09-18
Repository: `wanghuinet/luckread`
Baseline: Batch G final sweep reported at reviewed head `2176675f4262fd87718f4ee63746d949119bfdea`

## Purpose

This register isolates the AUTH records that the Mapping-0 sweep identified as still missing or partial. It is a blocker register only. It does not create API contracts, DTOs, entities, persistence records, security contracts, provider mappings, or runtime evidence.

## Fail-closed rule

An AUTH record may not be promoted from `MISSING` or `PARTIAL` merely because a related document exists. Promotion requires an authoritative contract/source plus deterministic verification and evidence bound to the resulting commit.

## Canonical residuals

| Feature | Current status | Repository authority observed | Remaining closure blocker |
|---|---|---|---|
| AUTH-006 | MISSING | `contracts/api/AUTH-006-passkey-webauthn-contract.v1.json` exists; status is `CONTRACTED_NOT_VERIFIED` | DTO/entity/persistence/security/runtime evidence and Mapping-0 validation remain incomplete |
| AUTH-007 | MISSING | Blueprint + reconciliation artifacts observed | Canonical MFA API/DTO/entity/security lifecycle contract surface not established |
| AUTH-008 | PARTIAL | Blueprint + reconciliation artifacts observed | Canonical OAuth API/DTO/entity/security/test mapping remains incomplete |
| AUTH-009 | PARTIAL | Blueprint + reconciliation artifacts observed | Canonical linked-identity API/entity/security mapping remains incomplete |
| AUTH-013 | PARTIAL | Blueprint + reconciliation artifacts observed | Account-state enforcement mapping remains incomplete |
| AUTH-014 | PARTIAL | Blueprint + reconciliation artifacts observed | Provider/linked-identity/account-state mapping remains incomplete |
| AUTH-015 | PARTIAL | Blueprint + reconciliation artifacts observed | Provider/linked-identity/account-state mapping remains incomplete |
| AUTH-016 | PARTIAL | Blueprint + reconciliation artifacts observed | Provider/linked-identity/account-state mapping remains incomplete |

## Required closure evidence

For each residual, the next admissible closure package must contain:

1. an authoritative source or contract for the feature;
2. an explicit mapping binding to that authority;
3. validation that the binding is consistent with the Canonical Feature Inventory and Canonical Mapping;
4. where applicable, executable implementation and test evidence;
5. commit-bound evidence recorded after validation.

Until all required evidence exists, the status remains fail-closed.

## Non-actions

This register intentionally does not:

- add Feature IDs to the Canonical Feature Inventory;
- modify the 449 canonical mapping records;
- manufacture API / DTO / Entity / Field / Payload / Code edges;
- add D1 schema or migration changes;
- change Worker architecture;
- import D1-Fabric;
- delete v1.0 contracts or B01-B20 blueprints.

## Current acceptance impact

The AUTH residuals remain part of the existing Mapping-0 technical/runtime and reconciliation blockers. The AUTH-006 wording is now evidence-accurate: an API contract artifact exists, but its required downstream verification and evidence closure do not.

The structural handoff remains distinct from technical/runtime closure.
