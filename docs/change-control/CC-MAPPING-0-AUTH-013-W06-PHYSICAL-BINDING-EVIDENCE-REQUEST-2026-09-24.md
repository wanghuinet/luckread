# AUTH-013 W06 Physical Binding Evidence Request — 2026-09-24

- Decision ID: `CC-MAPPING-0-AUTH-013-W06-PHYSICAL-BINDING-EVIDENCE-REQUEST-2026-09-24`
- Feature: `AUTH-013`
- Canonical Worker: **W06**
- Canonical responsibility: Rights / Trust & Safety / Governance
- Canonical D1: **D1-03**
- Repository authority: GitHub `main`

## 1. Current verified state

The source-level W06 AuditEvent boundary is already verified:

- Source boundary: `workers/W06-governance/`
- W06 Audit Event Source CI Run `35948540401` = **SUCCESS**
- TypeScript check = PASS
- Source tests = **3/3 PASS**
- Canonical event action: `identity.account_state_changed`
- No D1-03 remote mutation was performed by the source slice.

AUTH-013 W02 evidence remains inherited and is not re-executed:

- D1-01 migration Run `35937873769` = SUCCESS
- W02 transition-kernel source verification Run `35943346415` = SUCCESS
- W02 transition tests = 13/13 PASS

## 2. Exact remaining external evidence

The repository still does **not** contain evidence-bound physical identity for W06 or physical identity for D1-03.

The following must be captured before deployment/persistence implementation is promoted:

1. Cloudflare account read-only inventory.
2. Exact Worker resource name/ID selected for canonical W06.
3. Exact D1 resource UUID selected for canonical D1-03.
4. Wrangler binding from W06 source to that D1 UUID.
5. Controlled deployment evidence.
6. Worker smoke/runtime evidence.
7. Only after the above: D1-03 schema/migration evidence for AuditEvent.

No resource name or UUID may be inferred from:
- `workers/W06-media`
- `workers/W06-governance`
- historical W00-W13/P01-P08 naming
- database display names
- directory names
- undocumented naming conventions.

## 3. Existing read-only inventory path

The repository already provides the required read-only workflow:

`.github/workflows/cloudflare-resource-inventory.yml`

Manual trigger URL:

https://github.com/wanghuinet/luckread/actions/workflows/cloudflare-resource-inventory.yml

The workflow collects:

- D1 name + UUID
- Worker name/ID
- Worker compatibility metadata
- total D1 count
- total Worker count

It performs no D1 DDL/DML and no Worker deployment.

## 4. Binding admission rule

The inventory result itself does **not** automatically assign a resource to W06.

A physical resource becomes W06/D1-03 authoritative evidence only after the project binding decision explicitly records:

`W06 → physical Worker resource`

and

`D1-03 → physical D1 UUID`

with exact UUID/resource identifiers and provenance from the controlled inventory.

Until that decision exists:

- W06 source implementation = **PASS_VERIFIED**
- W06 physical Worker binding = **BLOCKED_EXTERNAL**
- D1-03 physical binding = **BLOCKED_EXTERNAL**
- W06 deployment = **NOT_AUTHORIZED**
- AuditEvent remote persistence = **NOT_AUTHORIZED**
- AUTH-013 overall = **BLOCKED_NOT_GREEN**

## 5. Anti-inference rule

Do not create `luckread-w06`, select a D1 UUID, or create a Wrangler binding merely because the logical architecture requires W06/D1-03. Physical identity is evidence, not an architectural guess.

## 6. Next cursor

**Controlled Cloudflare inventory → explicit W06/D1-03 physical binding decision → add exact Wrangler binding → controlled W06 deployment/smoke → implement AuditEvent persistence/publication → bind cache/session side effects → E2E security/integration evidence → AUTH-013 Evidence Registry promotion.**
