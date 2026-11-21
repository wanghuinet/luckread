# CC-MAPPING-0-SEMANTIC-DRAFT-SCOPE-2026-09-19

## Status

CLOSED — VALIDATED BY GITHUB ACTIONS (2026-09-19)

## Finding

`scripts/contract-semantic-ci.mjs` previously applied full Permission/Idempotency/State semantic admission rules to operations explicitly marked:

`x-luckread-contract-status: DISCOVERY_DRAFT`

This caused draft operations to fail the semantic admission gate for incomplete permission/header details even though they were not canonical admission inputs.

## Resolution

The validator now:
- keeps structural operation-policy and OpenAPI referential checks;
- keeps operationId uniqueness checking;
- defers full permission/state/audit/idempotency/optimistic-lock admission checks for `DISCOVERY_DRAFT` operations;
- continues to apply full semantic checks to operations without the draft status.

## Verification

GitHub Actions run `35421384870` on the resulting commit demonstrated that the previous large draft-related error set disappeared.

The Semantic Cross-Contract Gate now fails only on:
1. duplicate OpenAPI `operationId`;
2. policy-only `getEntitlementsOp` absent from OpenAPI;
3. the consequent inability to locate `getEntitlementsOp` for OpenAPI policy binding.

These remaining failures are independent canonical contract conflicts and remain governed by their own Change Control.

## Boundary

This closes the validator scope defect only.

It does not:
- admit any Discovery Draft API;
- choose a permission;
- rename an operationId;
- change the Canonical Mapping;
- authorize implementation.

## Evidence

- `scripts/contract-semantic-ci.mjs`
- GitHub Actions run `35421384870`
- job `105839625046`
- `artifacts/mapping-0/current-ci-failure-evidence-2026-09-19.json`

Underlying API/OpenAPI conflicts remain OPEN.
