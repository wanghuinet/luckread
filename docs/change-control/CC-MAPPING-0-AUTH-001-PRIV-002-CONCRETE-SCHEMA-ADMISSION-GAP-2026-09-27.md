# CC-MAPPING-0-AUTH-001-PRIV-002-CONCRETE-SCHEMA-ADMISSION-GAP-2026-09-27

## Status

`EXTERNAL_AUTHORITY_DECISION_REQUIRED / CONCRETE_CONTRACT_BLOCKED`

## Scope

Convert the remaining PRIV-002 concrete persistence gap into an atomic authority-decision matrix. This document does not select values by inference.

## Already reconciled

The following semantics are admitted by:
`docs/change-control/CC-MAPPING-0-AUTH-001-PRIV-002-CONSENT-AUTHORITY-RECONCILIATION-2026-09-27.md`

- policy version stored and immutable per consent record;
- actor/resource scope authoritative;
- deterministic duplicate submission;
- invalid policy version rejected;
- durable withdrawal;
- retained immutable history;
- authorized deterministic history query;
- unauthorized mutation denied without mutation;
- lifecycle retention follows the platform retention contract.

## Concrete decisions still required

| Decision item | Current authoritative value | State | Required authority |
|---|---|---|---|
| canonical consent entity ID | none found | BLOCKED | Entity/Field Contract admission |
| physical table/collection | none found | BLOCKED | Persistence mapping admission |
| consent record field IDs | none found | BLOCKED | Entity Field Contract admission |
| consent state enum | only semantic examples: granted/revoked/restricted-processing | BLOCKED | Canonical consent state contract |
| consent purpose/type vocabulary | none found | BLOCKED | Canonical consent contract |
| legal-basis vocabulary | none found | BLOCKED | Canonical privacy/consent contract |
| policy-version representation | policy version is required and immutable; exact field ID/type not frozen | BLOCKED | Canonical consent contract |
| retentionClass for consent | generic lifecycle classes exist; consent-specific class not frozen | BLOCKED | Retention binding admission |
| retention duration / retentionUntil rule | generic lifecycle contract only; consent-specific duration not frozen | BLOCKED | Retention policy admission |
| withdrawal event/schema | withdrawal behavior admitted; event payload/schema not frozen | BLOCKED | Event Contract admission |
| AUTH-001 envelope consent binding | no concrete field binding | BLOCKED | AUTH-001 envelope contract admission |

## Search conclusion

Current repository inspection found no authoritative `ENT-CONSENT`, `consentId`, `consentType`, or consent-specific Entity/Field Contract. The L5/L6 registry is execution-specification authority for behavior, not a concrete persistence schema.

Therefore no table, field, enum, legal-basis vocabulary, retention duration, migration, or runtime implementation may be invented from neighboring domains.

## Decision packet

The next authority decision should answer the blocked matrix above in one dedicated PRIV-002 contract/control change. Until then:

- AUTH-001 registration runtime remains unauthorized;
- no consent migration is authorized;
- no consent Worker/D1/Queue is introduced;
- no Evidence Registry promotion occurs.

## Non-authoritative inputs explicitly excluded

Historical/archive capability matrices and unrelated advertising/privacy consumers may describe consent behavior, but they do not by themselves freeze LuckRead's canonical PRIV-002 persistence schema.


## 2026-09-27 decision packet consolidation

The exhaustive current-head search is now frozen by:
`docs/change-control/CC-MAPPING-0-AUTH-001-PRIV-002-CONSENT-CONTRACT-DECISION-PACKET-2026-09-27.md`.

No new repository authority was found for the remaining concrete values. This converts the gate from an open-ended re-audit into a single explicit authority-decision dependency.

The remaining values MUST be admitted by one canonical PRIV-002 contract/change-control decision before AUTH-001 runtime authorization.
