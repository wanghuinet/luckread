# CC-MAPPING-0-AUTH-013-EVIDENCE-REGISTRY-RECONCILIATION-2026-09-29

## Status

`APPROVED_FOR_EVIDENCE_RECONCILIATION`

## Trigger

Controlled AUTH-013 Public Transport HTTP E2E Run `36503534440` completed successfully
against deployed source `f4c329b74f7110af76c7ba7339bfd9d3cb81f910`, using deployment
Run `36502171590`.

## Evidence accepted into the canonical registry

The run provides three bounded evidence claims:

- `AUTH-013::PUBLIC_HTTP_E2E`
- `AUTH-013::PUBLIC_HTTP_SECURITY_E2E`
- `AUTH-013::PUBLIC_D1_AUTHORITATIVE_RESULT`

All three are tied to the non-expired workflow artifact `11006620069`.

## Reconciliation decision

1. Admit the above three executable PASS evidence records as `VERIFIED` using
   `INHERITED_UNCHANGED_SCOPE`, because the tested runtime source remains the
   deployed `f4c329b...` and later changes in the evidence path are governance/
   tooling-only.
2. Bind the existing W01/W02 runtime source references into the AUTH-013 canonical
   Mapping records.
3. Remove only stale wording that claims D1 persistence, DTO, runtime and public
   evidence are wholly incomplete.
4. Keep AUTH-013 `PARTIAL`. Do not promote it to GREEN because full state-machine
   lifecycle coverage and complete side-effect convergence are not proven by the
   single public E2E scope.
5. Keep global Evidence Registry and Mapping 0 status fail-closed; other feature
   records and their blockers are unaffected.

## Remaining AUTH-013 gaps

- Public/executable coverage for FROZEN, SUSPENDED, BANNED and contracted escalation/
  restoration paths is not feature-wide complete.
- Approval-required BANNED behavior is not proven by this E2E.
- Complete cache/deindex/feed/search convergence across the contracted lifecycle states
  is not proven by this E2E.
- Full feature-wide evidence graph reconciliation remains pending.

## Non-changes

No runtime Worker code, Contract/OpenAPI semantics, D1 schema, Payload version,
Worker topology, Service Binding topology, authorization rule or production deployment
is changed.

## Controls

- Backup: `backup/pre-auth013-evidence-registry-reconciliation-20260929`
- Working branch: `reconcile/auth013-evidence-registry-20260929`
- E2E Run: `36503534440`
- Artifact: `11006620069`
