# CC-MAPPING-0-CODE-EVIDENCE-API-DISCOVERY-2026-09-29

## Status

`IMPLEMENTED / VALIDATION_PENDING`

## Problem

`scripts/build-code-evidence-inventory.mjs` previously emitted every API operation as:

`implementationStatus = UNRESOLVED`

regardless of whether canonical Mapping already contained explicit worker code evidence.

This created false negative implementation blockers. For example, current main already binds concrete W01/W02 source files for `authRegister` and `transitionAccountState`.

## Minimal correction

The generator now consumes:

`contracts/alignment/cross-system-mapping.v1.json`

and, for each API operation, promotes implementation only when the canonical Mapping explicitly contains `workers/...` code-evidence references.

Rules:

- explicit mapped worker refs → `IMPLEMENTED`;
- `.test.` / `.spec.` refs → `testRefs`;
- no mapped worker refs → preserve `UNRESOLVED`;
- unresolved records retain their existing sourceRefs and blocker;
- implemented records add the mapping file to their sourceRefs;
- no implementation is inferred from API names, OpenAPI paths, directory names or historical documents.

## Current generated delta

Exactly two API operation records change:

1. `authRegister`
2. `transitionAccountState`

No other API operation is promoted.

## Non-changes

- No business runtime code.
- No API/DTO/Contract semantics.
- No D1 schema.
- No Worker topology.
- No Cloudflare resource.
- No Evidence Registry status promotion.
- No Mapping 0 GREEN promotion.

## Validation expectation

The existing Alignment CI regenerates the Code Evidence Inventory and checks the generated file for drift. The PR is therefore the validation boundary; no manual GREEN claim is made.

## Controls

Backup: `backup/pre-code-evidence-api-discovery-fix-20260929`
Working branch: `fix/code-evidence-api-discovery-20260929`
