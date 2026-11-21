# Luckread Worker Topology Change Control v1.0

> Status: **PENDING APPROVAL / ARCHITECTURE CHANGE CONTROL**
>
> This document does not silently promote a proposed Worker allocation into the canonical architecture.

## 1. Change request

Current Architecture Blueprint freezes the implementation target at:

- 12 Workers
- 4 D1 domains
- 25 Contract Tasks

Repository history contains incompatible Worker models. Therefore the final 12-worker identity/responsibility matrix must be explicitly promoted through Change Control before Mapping and Contracts may depend on it.

## 2. Conflicting historical models

### Legacy model A

`docs/300-ARCHITECTURE-BASELINE-WORKER-D1-R2-CACHE-MAP-v1.0.md`

- W00–W08
- D1-01–D1-03

This is a historical logical-domain model and does not match the current 12/4/25 target.

### Legacy model B

`contracts/resource-budget/edge-first-worker-topology.json`

- W01–W13 logical workers
- P01–P08 physical worker groups

This is also historical and does not match the current 12-worker target.

## 3. Proposed resolution

Adopt a single canonical Worker Master with exactly W01–W12, while retaining both legacy models as historical evidence.

The previously created `docs/04-WORKER-MASTER-v1.0.md` is therefore treated as a **proposal pending approval**, not as an independent source of truth.

No legacy Worker ID is automatically merged, renamed, deleted, or reassigned merely to obtain a count of twelve.

## 4. Approval invariants

Approval of the 12-worker topology must preserve all of the following:

1. Exactly 12 canonical Worker boundaries.
2. Exactly 25 Contract Tasks.
3. Exactly 4 D1 domains.
4. Every Task has one authoritative primary Worker.
5. Secondary participation cannot transfer authority.
6. No Worker may create an implicit fifth D1 domain.
7. No Worker may become an unrestricted cross-domain database writer.
8. Public API exposure must not imply business-state ownership.
9. Payload Core remains immutable and is used only through supported extension points.
10. Cloudflare implementation details remain replaceable for later PostgreSQL/GCP migration.
11. Worker-to-Worker calls require explicit contract, auth, timeout, retry and observability rules.
12. Mapping must remain fully traceable from Feature → Task → Worker → D1 → API/Data/Security/Event/Test/Evidence.

## 5. Approval gate

The topology is **NOT GREEN** until an authorized architecture decision explicitly approves the proposed W01–W12 identity/responsibility matrix.

Until then:

- Worker Mapping = PENDING
- D1 Mapping = PENDING
- Contract generation = BLOCKED
- Implementation based on Worker ownership = BLOCKED

## 6. Next controlled step

After approval:

1. Promote the Worker Master to canonical.
2. Update Worker Binding Mapping.
3. Create the 4-D1 Master.
4. Bind each primary Task to its authoritative D1 domain.
5. Complete Feature → Task → Worker → D1 Mapping.
6. Run conflict/orphan/duplicate audit.
7. Freeze Mapping.
8. Start Contract-First implementation.
