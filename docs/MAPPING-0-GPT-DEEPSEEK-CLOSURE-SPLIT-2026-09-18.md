# LuckRead Mapping 0 — GPT / DeepSeek Closure Split
Date: 2026-09-18
Repository: wanghuinet/luckread
Main at review: 66d216df4816c13c90edf3131517a987ab9a5436

## 1. Current verified baseline

- Canonical Feature Inventory: 449
- Canonical Mapping records: 449
- Missing records: 0
- Orphan records: 0
- Mapping 0 Structural Gate: GREEN
- Evidence reference coverage: 449/449 (100%)
- Records with API technical edge: 11
- Records with Entity technical edge: 9
- Records with any technical edge (API/Entity/Payload/Code): 11
- Payload collection edges: 1
- Code evidence edges: 0
- Complete technical closure: 0/449

This is a structural Mapping 0 GREEN state, not business implementation GREEN.

## 2. GPT ownership — near-closure / high-coupling zone

GPT owns these 11 records and the final acceptance pass:

AUTH-001
AUTH-002
AUTH-003
AUTH-004
AUTH-005
AUTH-006
AUTH-010
AUTH-011
AUTH-012
USER-001
USER-006

Reason: these are the only records currently carrying executable-contract-shaped technical edges. They are the highest-risk records for API/entity authority conflicts, stale operation IDs, field authority drift, and accidental promotion.

GPT tasks:
1. Reconcile each existing API edge against canonical OpenAPI/inventory authority.
2. Reconcile each existing Entity edge against Entity Catalog/Field Authority.
3. Add only exact, evidence-backed edges from current canonical sources.
4. Remove/repair only demonstrably stale or contradictory edges; preserve fail-closed status when proof is incomplete.
5. Do not infer Payload collections, physical D1 tables/columns, runtime handlers, tests, or Evidence Registry execution from documentation alone.
6. Execute Mapping 0, contract, reconciliation, and evidence-reference validation after each batch.
7. Perform final cross-system audit after DeepSeek returns its 438-record batch.

Important: AUTH-003~006 feature contracts must not be treated as Canonical OpenAPI admission by themselves. Canonical DTO bindings require exact OpenAPI admission.

## 3. DeepSeek ownership — bulk closure

DeepSeek owns all remaining 438 records that currently have NO API, Entity, Payload, or Code technical edge.

DeepSeek scope is determined dynamically as:
all canonical mapping records
MINUS
{AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, AUTH-010, AUTH-011, AUTH-012, USER-001, USER-006}

DeepSeek should work in deterministic batches by feature family/domain.

Mandatory rules:
- Never manufacture an API operation ID.
- Never infer Entity/Field ownership from feature names, routes, directories, Payload collection names, Worker names, or old documents.
- Never invent physical D1 schema.
- Never add Payload collection or code evidence without direct repository evidence.
- Never promote a record to GREEN merely because a contract or markdown reconciliation file exists.
- Preserve existing records and evidence references.
- Every promoted edge needs an explicit source reference.
- When proof is absent, keep the edge empty and status fail-closed.
- Do not implement business handlers/collections/migrations during Mapping 0 closure.
- Do not modify the 11 GPT-owned records.

## 4. Recommended DeepSeek batching order

Batch A: AUTHZ / ORG / ADMIN / TENANT / GOV / SEC / PRIV / OPS / CONFIG / API cross-cutting
Batch B: ARTICLE / CONTENT / CREATOR / MEDIA
Batch C: FEED / SOCIAL / COMMUNITY / REL
Batch D: PAY / ADS / GROWTH / ANALYTICS
Batch E: SEARCH / REC / AI-related families / DATA / MON / OBS
Batch F: DEV / CLIENT / EXT / EXTCONTENT / STORAGE / JOB / MSG / NOTIFY / SUPPORT / PG / CF / I / RIGHTS / SAFETY / SEO
Batch G: final unresolved sweep and duplicate/conflict scan

The exact batch membership must be derived from current Feature Inventory and Canonical Mapping, not guessed from this document.

## 5. Handoff protocol

DeepSeek:
- read this file first;
- fetch current main;
- compute the current 438-record ownership set;
- work in small deterministic batches;
- commit each batch;
- after each commit run Mapping 0 structural/contract validation and reconciliation;
- report changed Feature IDs, before/after edge counts, source references, blockers, and CI result.

GPT:
- reviews every DeepSeek batch at acceptance;
- rejects unsupported inference;
- resolves cross-domain authority conflicts;
- owns final Mapping 0 closure decision and final evidence/gate audit.

## 6. Success condition

Do not call the project fully closed until:
- Feature Inventory and Canonical Mapping are exactly aligned;
- all intended API/Entity/Field/Persistence/Payload/Code/Evidence edges are either proven or explicitly fail-closed;
- no unresolved contradiction remains hidden;
- Mapping 0 structural gate is GREEN;
- downstream contract/reconciliation/evidence gates are independently GREEN where required;
- no business implementation was introduced merely to force closure.
