# AUTH-002 Real-Evidence Reconciliation v1

Status: BLOCKED_NOT_GREEN

## Scope

Feature: `AUTH-002` — login / logout.

Canonical API operations:
- `authLogin` — `POST /auth/login`
- `authLogout` — `POST /auth/logout`

## Evidence found

1. `contracts/api/auth-operation-policy.v1.json` defines both operations and marks them `CONTRACTED_PARTIAL`.
2. `authLogin` requires account-state evaluation after identity resolution, anti-abuse controls, constant failure semantics, credential non-logging/non-return, and refresh-token rotation.
3. `authLogout` requires authenticated current-user scope, permission `user.session.revoke`, idempotent revocation, bounded revocation propagation, and no returned session secret.
4. `contracts/state-machines/account.json` is authoritative for account lifecycle and declares token-invalidation states: `SUSPENDED`, `BANNED`, `DELETION_PENDING`, `DELETED`.
5. `contracts/entity/entity-catalog.v1.json` currently declares `ENT-SESSION` as `PROPOSED`, not `VERIFIED`.
6. `contracts/entity/entity-field-contract.v1.json` currently declares `ENT-SESSION` as `PROPOSED` with an empty field list.
7. The canonical cross-system mapping currently records `AUTH-002` as `PARTIAL` with missing session DTO/entity mappings and missing state/security E2E evidence.

## Negative evidence / missing proof

The current repository evidence does not prove a complete executable chain for `AUTH-002` across:

`request -> validation -> identity lookup -> credential verification -> account-state enforcement -> session creation/revocation -> authoritative persistence -> response DTO -> security controls -> integration test -> evidence registry -> commit SHA`.

No canonical `ENT-SESSION` field contract or authoritative persistence mapping is currently available. Contract presence and Payload `users` auth configuration are not sufficient to promote session implementation to GREEN.

## Required closure criteria

AUTH-002 may become GREEN only after all of the following are evidence-bound and validator-accepted:

- canonical Session DTO contract and DTO implementation evidence;
- canonical `ENT-SESSION` entity and explicit field contract;
- authoritative D1 persistence/table/column evidence;
- executable login and logout handlers bound to the canonical API operations;
- account-state enforcement and token invalidation evidence;
- security evidence for enumeration resistance, credential non-disclosure, self-scope revocation, and cache-bypass revocation;
- integration and negative-path tests with actual execution evidence;
- non-empty Evidence Registry references bound to `AUTH-002`;
- final Mapping 0 validator result tied to the commit SHA.

## Gate result

`AUTH-002 = BLOCKED_NOT_GREEN`

Reason: downstream implementation and evidence contracts required by the canonical traceability chain are not yet established. Do not implement worker/runtime code solely to make this mapping appear green.
