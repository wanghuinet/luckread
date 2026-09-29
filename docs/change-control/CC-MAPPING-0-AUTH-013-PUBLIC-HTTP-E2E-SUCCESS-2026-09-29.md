# CC-MAPPING-0-AUTH-013-PUBLIC-HTTP-E2E-SUCCESS-2026-09-29

## Status

`EVIDENCE_CAPTURED / REGISTRY_RECONCILIATION_PENDING`

## Evidence

Controlled AUTH-013 Public Transport HTTP E2E Run `36503534440` completed successfully on
main commit `b91b49d6262ced5631d4d246d1573fa03583752c`.

The workflow verified the deployed source provenance against:

- tested/deployed source: `f4c329b74f7110af76c7ba7339bfd9d3cb81f910`
- deployment run: `36502171590`
- W01 public path: `/v1/users/{userId}/account-state`
- D1: `luckread`

All workflow execution steps completed successfully, including:

- public 401 unauthenticated denial;
- mandatory 428 `If-Match`;
- 403 client-authority injection denial;
- authorized 200 transition with the admitted response shape;
- stale 412 `If-Match`;
- revoked-session 401 denial;
- authoritative D1 result checks;
- synthetic fixture cleanup and cleanup verification.

Artifact: `11006620069`  
Artifact digest: `sha256:5a2ef6ead447dc908fa374aa2c9632d76ef3050080afb8dc81fd03f6901311f3`

## Governance disposition

This is sufficient to close the previously missing **public HTTP execution evidence**
sub-gate for the tested deployment scope.

It does **not** by itself make the canonical Evidence Registry GREEN or Mapping 0 GREEN.
The canonical registry still has its own global tested-commit/freshness and full
Feature→Mapping coverage conditions.

No runtime, Contract/OpenAPI, D1 schema, Payload version, Worker topology, Service Binding,
authorization rule, or production deployment is changed by this reconciliation record.

## Backup

`backup/pre-auth013-e2e-success-reconciliation-20260929`
