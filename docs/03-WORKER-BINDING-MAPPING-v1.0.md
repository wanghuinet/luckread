# Luckread Worker Binding Mapping v1.0

> Status: **ACTIVE / BINDING AUDIT — BLOCKED BY AUTHORITATIVE WORKER MASTER GAP**
>
> This document is subordinate to `docs/00-PROJECT-BLUEPRINT-v1.4.md` and `docs/02-FINAL-MAPPING-v1.0.md`.

## 1. Purpose

The Feature → Task mapping is complete at domain/range level. The next required mapping dimension is:

```text
Feature → Task → Worker → D1
```

The architecture Blueprint fixes the target at **12 Workers / 4 D1 domains / 25 Tasks**, but it does not itself publish the canonical identity and responsibility definition for each of the 12 Workers.

Therefore this batch performs a **binding audit**, not an invented Worker allocation.

## 2. Frozen Target

| Dimension | Target | Status |
|---|---:|---|
| Contract Tasks | 25 | FROZEN |
| Workers | 12 | FROZEN COUNT |
| D1 Domains | 4 | FROZEN COUNT |

The count is authoritative. Worker names, IDs, ownership boundaries and Task-to-Worker assignments require an authoritative Worker Master before they can become `MAPPED`.

## 3. Worker Slot Registry

| Worker Slot | Canonical ID | Responsibility | Task Binding | Status |
|---|---|---|---|---|
| W01 | PENDING | PENDING | PENDING | BLOCKED |
| W02 | PENDING | PENDING | PENDING | BLOCKED |
| W03 | PENDING | PENDING | PENDING | BLOCKED |
| W04 | PENDING | PENDING | PENDING | BLOCKED |
| W05 | PENDING | PENDING | PENDING | BLOCKED |
| W06 | PENDING | PENDING | PENDING | BLOCKED |
| W07 | PENDING | PENDING | PENDING | BLOCKED |
| W08 | PENDING | PENDING | PENDING | BLOCKED |
| W09 | PENDING | PENDING | PENDING | BLOCKED |
| W10 | PENDING | PENDING | PENDING | BLOCKED |
| W11 | PENDING | PENDING | PENDING | BLOCKED |
| W12 | PENDING | PENDING | PENDING | BLOCKED |

`W01`–`W12` above are reservation slots only; they are not claims that these identifiers are already canonical.

## 4. Conflict Audit

A repository search found an older document, `docs/300-ARCHITECTURE-BASELINE-WORKER-D1-R2-CACHE-MAP-v1.0.md`, defining **W00–W08** and **D1-01–D1-03**. That document also explicitly describes those identifiers as a previous logical-domain model.

It conflicts with the current Architecture Blueprint's final target of **12 Workers / 4 D1 domains**. It therefore cannot be used to fill the current 12-worker Mapping without formal reconciliation/change control.

Likewise, the current Mapping explicitly prohibits inferring Worker/D1 ownership from existing code, Payload Collections, directory names or routes.

**Decision:** preserve the old W00–W08 mapping as historical evidence; do not promote it into the final 12-worker Mapping.

## 5. Required Worker Master Before Binding

The authoritative Worker Master must define for every W01–W12:

1. Worker ID and immutable identity.
2. Worker name and execution purpose.
3. Primary Contract Tasks.
4. Allowed secondary Task responsibilities, if any.
5. Public/internal API ownership.
6. Runtime boundary.
7. Authentication and authorization boundary.
8. D1 read/write permissions.
9. R2 permissions where applicable.
10. Cache permissions.
11. Queue/event responsibilities.
12. Cross-worker call rules.
13. Timeout/retry/backpressure behavior.
14. Observability and audit ownership.
15. Deployment unit and environment configuration.
16. Test and evidence obligations.
17. Payload boundary, if applicable.

## 6. Binding Rule

After the Worker Master is frozen, Mapping will be expanded as:

```text
Feature ID
  → Task ID
  → Worker ID
  → D1 Domain ID
  → API ID
  → Data ID
  → Security ID
  → Event ID
  → Test ID
  → Evidence ID
```

No implementation may use `PENDING` ownership as authorization to create a new Worker boundary.

## 7. Current Result

- Feature-domain Mapping: **43 / 43 domains covered**.
- Task Master: **25 / 25 defined**.
- Worker count: **12 / 12 reserved by final architecture target**.
- Worker identity/ownership binding: **0 / 12 contract-valid** until the Worker Master is formally frozen.
- D1 binding: **0 / 4 contract-valid** until the D1 Master is formally frozen.

This is a deliberate quality gate, not incomplete work caused by implementation failure.

## 8. Next Step

Create/freeze the **12-Worker Master**, then bind Workers to the 25 Tasks and 43 Blueprint domains. Immediately after that, create the **4-D1 Master** and resolve the full Task → Worker → D1 matrix.
