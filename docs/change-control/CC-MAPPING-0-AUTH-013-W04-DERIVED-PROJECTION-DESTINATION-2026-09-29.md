# CC-MAPPING-0-AUTH-013-W04-DERIVED-PROJECTION-DESTINATION-2026-09-29

## Status

`ADMITTED_FOR_IMPLEMENTATION`

## Decision

Admit exactly one concrete, non-authoritative Derived Projection Destination for AUTH-013/W04:

- Destination type: Cloudflare KV namespace
- Logical destination: `AUTH013_W04_DERIVED_PROJECTION`
- Intended physical resource name: `luckread-w04-auth013-projection`
- Owner: W04
- Source authority: D1-01 AUTH-013 account-state authority via canonical `identity.account_state_changed`
- Purpose: derived Feed/Recommendation/Search projection state and deindex tombstone/version markers only
- Authority: NONE; rebuildable from authoritative state/events
- Worker topology: unchanged at 12 Workers / 4 D1
- D1 topology: unchanged; no new D1
- Queue transport: existing `luckread-auth013-account-state-projection` → `luckread-w04`
- DLQ: existing `luckread-auth013-account-state-projection-dlq`

This is a Change Control admission of one derived destination. It is not permission to create another storage authority, Worker, D1, public API, or search service.

## Why KV is the bounded destination

KV is used only as a rebuildable derived projection/cache destination. The record MUST carry source authority, source version, policy version, creation/freshness metadata, and lifecycle/deindex semantics. W04 MUST NOT use KV as authoritative account/content/rights state.

## Required record semantics

Each projection record is keyed by canonical resource identity and MUST include at least:

`resourceType`, `resourceId`, `sourceAuthority`, `sourceVersion`, `eventId`, `projectionVersion`, `createdAt`, `staleAfter`, `policyVersion`, and `state`.

Allowed states for AUTH-013 projection reaction are `ACTIVE`, `STALE`, and `PURGED`. A stale or purged record MUST NOT resurrect a deleted/restricted resource.

## Implementation boundary

Only these changes are admitted:

1. Provision or adopt the single KV destination.
2. Register its concrete namespace identifier in repository evidence after Cloudflare verification.
3. Bind W04 to the existing AUTH-013 projection queue and this KV namespace.
4. Implement bounded, idempotent consumer handling with per-resource version rejection and purge/deindex behavior.
5. Produce CI and runtime evidence.

No Payload Core change, no D1 migration, no Worker topology change, no public API redesign, and no second projection destination.

## Acceptance gates

- Change Control is merged before implementation promotion.
- Contract/Mapping CI passes against the admitted destination record.
- Cloudflare provisioning evidence identifies exactly one KV namespace.
- W04 live binding evidence shows the existing projection queue consumer and exactly the admitted KV binding.
- Runtime evidence proves one logical event is applied once, duplicate delivery is idempotent, older versions cannot regress state, and PURGED state is not resurrected.
- GREEN is forbidden until all gates above are evidenced and reconciled.

## Rollback / safety

The backup branch is `backup/pre-auth013-w04-derived-destination-20260929`.

If the destination or binding cannot satisfy the gates, leave AUTH-013/W04 BLOCKED; do not invent a replacement destination or expand topology.
