# AUTH-002–AUTH-006 Evidence Admission Checklist v1.0

## Status

`FAIL_CLOSED`

An evidence item is admissible only when all applicable checks pass.

## Identity

- repository is the intended repository;
- commit SHA is exact and reproducible;
- dependency versions match the locked contract;
- target environment is identified;
- target D1 is identified without exposing credentials.

## Execution

- evidence was produced by an executable command or CI job;
- exit status is captured;
- output is non-empty;
- artifact is stored under the expected evidence namespace;
- timestamps and commit identity are available where required.

## Persistence

- actual schema is inspected;
- actual migration result is captured;
- table/column/index claims match the observed schema;
- prohibited secret persistence is negatively verified;
- relationship/integrity claims have corresponding evidence.

## Runtime

- actual application/runtime path was exercised;
- request and response contract was checked;
- authoritative identity is proven;
- lifecycle transition is proven;
- failure path is proven where required.

## Security

- secrets are not returned;
- secrets are not persisted in plaintext;
- unauthorized access is denied;
- replay/expiry/wrong-purpose behavior is verified where applicable;
- user isolation is verified where applicable.

## Mapping binding

- Evidence ID references the actual artifact;
- artifact belongs to the tested commit SHA;
- mapping row references the Evidence ID;
- no evidence item is reused for a materially different claim without an explicit contract allowing reuse;
- Mapping-0 validates the row after evidence registration.

## Rejection conditions

Reject the evidence if it is documentation-only, historical, empty, inferred, generated without execution, from a different commit, from an unintended environment, or incapable of proving the claim assigned to it.

## Final rule

Evidence admission changes verification state only. It never changes canonical API/entity/field definitions. If implementation and mapping disagree, stop and reconcile the contract before proceeding.
