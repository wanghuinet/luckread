# Change Control — 1.1 Analytics OSS Reuse and Dedicated Analytics Store — 2026-10-12

**Status:** APPROVED FOR 1.1 CONTRACT ADDENDUM; IMPLEMENTATION AND PHYSICAL PROVISIONING REMAIN GATE-CONTROLLED
**Scope:** analytics capability only
**Owner:** W11 / T22 / T23

## 1. Decision

Add `docs/1.1-ANALYTICS-OSS-REUSE-PLAN-v1.0.md` to the LuckRead 1.1 contract and use it as the normative design for reusing mature open-source analytics components.

Approve the following product-scope direction:

- Target approximately 80% reuse of eligible generic analytics-engine/dashboard code, conditioned on code/runtime/security/license audit.
- Evaluate Facet first as the single-Worker + D1 candidate; use Traks, HitsOnce, PostHog and Umami only within the roles and license limits stated in the addendum.
- Retain W11 as the sole analytics Worker and T22/T23 as its primary tasks.
- Preserve the four existing business D1 domains and all existing authority assignments unchanged.
- Allow one dedicated analytics-only D1 as an explicit exception for W11-derived analytics data. This is not a new business-authority D1 and cannot store or override authoritative account, content, social, commerce, entitlement, payment or ledger facts.
- Allow Neon PostgreSQL as an optional later-phase analytical store for extended history/complex queries. Neon is not required for the first release and does not become a business authority.
- Do not add a Worker, Queue or Service Binding for this plan. Use only already admitted event delivery contracts.

## 2. Precedence and limits

This supplemental change control supersedes the 2026-10-04 1.1 change-control decision and 1.1 scope document only for the analytics reuse strategy and the dedicated analytics-store exception described above. All other 1.1 scope, Feature IDs, Worker ownership, task assignment, Payload Core immutability, Better Auth boundaries, and the four existing business D1 authorities remain unchanged.

The four-D1 canonical topology record remains the record of the current state until the mapping, physical binding/access declaration, migration, and reconciliation artifacts are updated and verified. This document approves the scoped target; it does not assert that a D1 has been created, bound, deployed, or tested.

## 3. Required gates before implementation/provisioning

1. Complete upstream commit, package/file license, dependency and source-attribution audit.
2. Reconcile the analytics D1 exception in canonical Worker/D1 mapping and the W11 resource-access contract; ensure only W11 can access it.
3. Add and verify schema/migration, idempotency, retention, privacy, deletion, and rebuildability contracts.
4. Map each admitted 1.1 analytics feature to source event, API/DTO, metric definition, authorization, tests and evidence.
5. Keep current global gate closure requirements in `docs/00-CURRENT-GATE-STATUS.md`. This supplemental decision does not turn Mapping 0 Freeze, Contract Generation, Global Implementation Authorization, or any feature evidence GREEN.
6. Introduce Neon only after a distinct runtime/security/cost/data-lifecycle check and record it as optional; do not synchronously couple it to core business writes.

## 4. Stop conditions

- Do not copy AGPL-covered code until LuckRead's source-availability/commercial-license decision is documented.
- Do not provision/bind the dedicated D1 solely because this document exists; required mapping/access/migration gates must pass first.
- Do not modify D1-01..D1-04 business schema ownership, add another Worker, or introduce a Queue/Service Binding under this change.
- Do not make any analytics product the source of truth for domain facts.

## 5. Canonical references

- `docs/1.1-MATURE-CREATOR-PLATFORM-SCOPE-v1.0.md`
- `docs/1.1-ANALYTICS-OSS-REUSE-PLAN-v1.0.md`
- `docs/69-ANALYTICS-EXPERIMENT-GROWTH-CONTRACT-v1.0.md`
- `docs/69-ANALYTICS-OSS-INTEGRATION-ADDENDUM-v1.0.md`
- `docs/00-CURRENT-GATE-STATUS.md`
