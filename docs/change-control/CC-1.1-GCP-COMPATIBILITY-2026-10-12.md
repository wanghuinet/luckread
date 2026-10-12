# Change Control — 1.1 GCP Compatibility Guard — 2026-10-12

**Status:** APPROVED FOR 1.1 CONTRACT ADDENDUM; DESIGN COMPATIBILITY ONLY
**Scope:** 1.1 implementation boundaries for future PostgreSQL/GCP portability
**Owner:** Existing domain owners; W09 for platform/storage/reliability coordination
**Runtime effect:** None — current Cloudflare deployment remains authoritative

## 1. Decision

Add the “Future GCP compatibility guard” in `docs/1.1-MATURE-CREATOR-PLATFORM-SCOPE-v1.0.md` as a normative 1.1 design constraint.

This decision means 1.1 code should avoid unnecessary provider lock-in while continuing to use the current Cloudflare implementation. It does not authorize or schedule a GCP rollout.

## 2. Current topology remains frozen

- Keep the existing 12 Workers, four business D1 authorities and 25 Tasks unchanged.
- Keep the existing Queue and Service Binding topology unchanged.
- Keep Cloudflare Workers/runtime, Cloudflare edge/CDN and R2 as the current production implementation.
- The already approved W11 analytics-only D1 exception remains under its separate change control and gates. This document does not create, provision, bind or grant access to any database.
- Do not add a Worker, D1, Queue or Service Binding under this change.
- Do not change Payload Core, Better Auth, existing API semantics, domain ownership, or authoritative data boundaries.

## 3. Compatibility basis

The existing `contracts/database/cloudflare-d1-pg-portability.v1.json` remains the normative D1/PostgreSQL data portability contract. This change incorporates its logical-schema principle into 1.1 and adds explicit implementation guidance for stable API/DTO contracts, the Payload adapter boundary, R2 object references, provider-neutral events, idempotency, cache/security behavior, and single-writer cutover discipline.

The GCP capability reconciliation file `contracts/capability/reconciliation-batches/AK-postgresql-gcp-portability.v1.json` remains `NOT_GREEN`. No PG-001..PG-009 capability is promoted by this document.

## 4. Implementation and future cutover gates

During 1.1, apply compatibility rules to new or materially changed paths without triggering a broad rewrite solely for portability. Do not add GCP infrastructure as part of this addendum.

Any future production move to PostgreSQL/GCP must have a separate approved execution plan and evidence for:
1. Authority-scoped data inventory and source/target mapping.
2. Canonical export/import and preservation of IDs, timestamps, JSON/state semantics, relationships and uniqueness.
3. R2/media object-reference integrity and stable public delivery.
4. API/DTO, authorization, cache, load, backup/restore and runtime validation.
5. Reconciliation, an explicitly controlled single-writer cutover, rollback readiness and post-cutover verification.

No domain may have two uncontrolled authoritative write paths. Data shadowing or dual reads do not authorize dual writes.

## 5. Stop conditions

Stop if compatibility work would silently change business authority, API semantics, L1-L8 authorization behavior, Payload Core, Better Auth, current Worker ownership, current bindings/topology, or any approved domain D1 ownership. Record and approve a separate Change Control before any such change.

## 6. Canonical references

- `docs/1.1-MATURE-CREATOR-PLATFORM-SCOPE-v1.0.md`
- `docs/1.1-MATURE-CREATOR-IMPLEMENTATION-HARDENING-CONTRACT-v1.0.md`
- `contracts/database/cloudflare-d1-pg-portability.v1.json`
- `contracts/capability/reconciliation-batches/AK-postgresql-gcp-portability.v1.json`
- `docs/change-control/CC-1.1-ANALYTICS-OSS-REUSE-2026-10-12.md`
- `docs/00-CURRENT-GATE-STATUS.md`
