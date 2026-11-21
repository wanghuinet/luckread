# Luckread Platform Contract v1.0 — Historical Migration Record

> **Status: ARCHIVED / MIGRATED TO CANONICAL ARCHITECTURE BLUEPRINT**
>
> This file is retained as historical evidence. It is no longer an active architecture baseline.

## 1. Migration Target

The architecture principles of this document have been consolidated into:

`docs/00-PROJECT-BLUEPRINT-v1.4.md`

The functional capability source of truth remains:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

## 2. Principles Migrated

The following principles are now part of the canonical architecture Blueprint:

- Contract-First development and traceability;
- Feature → API → Data → Security → Runtime → Test → Evidence reconciliation;
- terminal runtime/request boundary;
- authoritative read/write separation;
- cross-domain write limits and explicit consistency handling;
- content/media/R2 boundary;
- cache is not a source of truth;
- versioned/idempotent events and asynchronous processing;
- high-frequency behavior aggregation and batch persistence;
- security invariants and protected-content rules;
- cost review as an architecture gate;
- PostgreSQL/GCP migration portability;
- runtime compatibility validation;
- reconciliation and GREEN gates;
- evidence must prove the complete delivery chain.

## 3. Historical Topology Values Not Carried Forward

The following values from v1.0 were historical planning values and are **not** frozen in the current architecture:

- 25 Business Contract Tasks;
- 12 Runtime Workers;
- 4 Physical D1 Domains;
- W01–W12 numbering tied to that topology.

The current architecture creates Workers/runtime services/storage domains only when a documented ownership, transaction, security, scaling, lifecycle, capacity, operational or migration boundary justifies the split.

## 4. Authority Rule

If this historical document conflicts with `docs/00-PROJECT-BLUEPRINT-v1.4.md`, the v1.4 Blueprint wins.

If a new product capability is discovered, it must first be added to the functional Blueprint with a Feature ID. It must not be added by modifying this historical document.

## 5. Migration Record

Migration completed as part of the architecture consolidation commit:

`1d3adc78c9eb077ff9f4c875f68772611d5a13a4`

This file must not be used as an implementation source of truth.