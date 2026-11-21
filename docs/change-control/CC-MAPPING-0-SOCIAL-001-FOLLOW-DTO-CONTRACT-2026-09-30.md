# Change Control: SOCIAL-001 Follow DTO Contract — 2026-09-30

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-FOLLOW-DTO-CONTRACT-2026-09-30`
- Status: `CONTRACT-FIRST / ADMITTED / VERIFICATION-PENDING`
- Parent Change Control: `CC-MAPPING-0-SOCIAL-001-FOLLOW-ENTITY-CONTRACT-2026-09-30`
- Base main: `047a82039da3a9ea6d865d075d5a8602423e32cc`
- Backup: `backup/social-follow-dto-before-20260930`
- Feature: `SOCIAL-001`
- Canonical ownership: `SOCIAL → T11 → W05 → D1-02`

## Scope

This slice closes only the canonical DTO edge for the two already-promoted Social Follow mutation operations.

| Operation | Method / Path | Request DTO | Response DTO | Success |
|---|---|---|---|---|
| `follow` | `POST /api/v1/social/follows` | `DTO-SOCIAL-FOLLOW-REQUEST` | none | 200 no-body |
| `unfollow` | `DELETE /api/v1/social/follows` | `DTO-SOCIAL-UNFOLLOW-REQUEST` | none | 204 no-body |

The canonical request schemas remain the existing inline OpenAPI schemas. The request body contains only required `targetUserId`, represented by the existing `ResourceId` schema.

## Canonical schema bindings

- `DTO-SOCIAL-FOLLOW-REQUEST`
  → `#/paths/~1social~1follows/post/requestBody/content/application~1json/schema`
- `DTO-SOCIAL-UNFOLLOW-REQUEST`
  → `#/paths/~1social~1follows/delete/requestBody/content/application~1json/schema`

Both operations are recorded as `NO_BODY_DTO` because the existing OpenAPI operations define no success response content.

The DTO layer is an exposure contract only. It does not redefine `ENT-SOCIAL-FOLLOW`, persistence shape, indexes, idempotency storage, event envelopes, cache representation, or runtime behavior.

## Non-actions

- No OpenAPI route or field is added.
- No followers/following discovery operation is promoted.
- No D1 table or migration is added.
- No Payload Collection is added.
- No W05 runtime handler is added.
- No event producer, cache projection, or Evidence Registry PASS record is added.
- `SOCIAL-001` remains `UNRESOLVED / NOT_GREEN` in Mapping 0 until downstream evidence closes the remaining edges.

## Remaining blockers

`SOCIAL-001` remains blocked on:

```text
Field-to-physical persistence schema
W05 executable handler
W05 → D1-02 binding evidence
event producer
cache/projection convergence
runtime positive/negative/concurrency/security evidence
Evidence Registry provenance
Mapping 0 promotion
```

`SOCIAL-002` followers/following queries remain `DISCOVERY_DRAFT` and require a separate API + DTO + field/persistence contract before promotion.

## Verification boundary

This Change-Control establishes Contract/DTO binding only. A passing Contract/OpenAPI CI run validates structural/admission integrity for this contract surface; it does not prove runtime implementation, persistence, security execution, concurrency behavior, or GREEN status.


## Downstream Persistence Link

The admitted Follow mutation DTOs are now linked to the dedicated persistence contract:

`contracts/persistence/SOCIAL-001-follow-relationship-persistence-contract.v1.json`

This link is contractual only; migration and runtime remain unverified.
