# CC-MAPPING-0-AUTH-013-W04-DERIVED-PROJECTION-DESTINATION-2026-09-29

## Status

`ADMITTED_FOR_IMPLEMENTATION`

## Decision

Adopt exactly one existing, concrete, non-authoritative Derived Projection Destination for AUTH-013/W04:

- Destination type: Cloudflare KV namespace
- Logical destination: `AUTH013_W04_DERIVED_PROJECTION`
- Physical resource: `globe`
- Namespace ID: `32f7e407128a43d59720d5d46736e084`
- Owner: W04
- Source authority: D1-01 AUTH-013 account-state authority via canonical `identity.account_state_changed`
- Purpose: derived Feed/Recommendation/Search projection state and deindex tombstone/version markers only
- Authority: NONE; rebuildable from authoritative state/events
- Worker topology: unchanged at 12 Workers / 4 D1
- D1 topology: unchanged; no new D1
- Queue transport: existing `luckread-auth013-account-state-projection` → `luckread-w04`
- DLQ: existing `luckread-auth013-account-state-projection-dlq`

The namespace `globe` was observed by the read-only Cloudflare inventory and is not referenced by the repository's W04 binding/configuration. This Change Control explicitly registers it for this single derived projection purpose; no new KV resource is created.

## Why this adoption is bounded

KV is used only as rebuildable derived projection/cache state. It is not account, content, rights, finance, or other business authority. W04 MUST reject stale/out-of-order versions and MUST NOT resurrect deleted or restricted resources.

## Required record semantics

Each projection record MUST carry at least:

`resourceType`, `resourceId`, `sourceAuthority`, `sourceVersion`, `eventId`, `projectionVersion`, `createdAt`, `staleAfter`, `policyVersion`, and `state`.

Allowed states for AUTH-013 projection reaction are `ACTIVE`, `STALE`, and `PURGED`. A stale or purged record MUST NOT resurrect a deleted/restricted resource.

## Implementation boundary

Only these changes are admitted:

1. Verify and register the existing `globe` namespace as the single W04 derived destination.
2. Bind W04 to the existing AUTH-013 projection queue and this KV namespace.
3. Implement bounded, idempotent consumer handling with per-resource version rejection and purge/deindex behavior.
4. Produce CI and runtime evidence.

No Payload Core change, no D1 migration, no Worker topology change, no public API redesign, and no second projection destination.

## Acceptance gates

- Change Control is merged before implementation promotion.
- Contract/Mapping CI passes against the admitted destination record.
- Cloudflare evidence verifies the exact KV namespace title and ID.
- W04 live binding evidence shows the existing projection queue consumer and exactly this KV binding.
- Runtime evidence proves one logical event is applied once, duplicate delivery is idempotent, older versions cannot regress state, and PURGED state is not resurrected.
- GREEN is forbidden until all gates above are evidenced and reconciled.

## Safety

Backup: `backup/pre-auth013-w04-adopt-globe-kv-20260929`.

If the existing namespace cannot satisfy the above semantics, leave AUTH-013/W04 BLOCKED; do not create a second destination.
