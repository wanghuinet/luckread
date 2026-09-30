# ALIGNMENT STEP 07 — Cross-System Mapping v1.0

## Purpose

Step 07 creates the explicit machine-readable relationship between the five evidence planes:

`Feature ↔ Entity/DB ↔ API ↔ Payload ↔ Code Evidence`

This is a mapping layer, not a second source of product truth.

## Non-negotiable rules

1. Blueprint Feature IDs remain the product source of truth.
2. Entity, API, Payload, and Code inventories remain evidence sources.
3. A mapping must use explicit identifiers or exact source references.
4. No fuzzy matching, semantic guessing, or AI inference is permitted.
5. A missing mapping is not silently converted into MATCH.
6. A mapping can be `MAPPED` when the relationship is explicit but the five systems are not yet fully equivalent.
7. `MATCH` is reserved for a fully evidenced compatible relationship.
8. `DRIFT`, `CONFLICT`, `DUPLICATE`, `UNRESOLVED`, and `BLOCKED` are first-class states.
9. The mapping registry must never manufacture an implementation merely because an inventory entry exists.
10. A generated empty registry remains `NOT_GREEN`.

## Mapping dimensions

Each mapping record may connect:

- Blueprint `featureId`
- Entity IDs
- API `operationId`s
- Payload collection slugs
- Code evidence references

The record also carries evidence and blockers so that a later reconciliation gate can explain exactly why a feature is or is not green.

## Intended lifecycle

```text
Blueprint Feature
      ↓
explicit mapping
      ↓
Entity / DB evidence
      ↕
API evidence
      ↕
Payload evidence
      ↕
Code evidence
      ↓
reconciliation
      ↓
MATCH / MAPPED / MISSING / EXTRA / DRIFT / CONFLICT / DUPLICATE / UNRESOLVED / BLOCKED
```

## Why this is separate from the inventories

Inventories answer **what exists** in each system.

The cross-system mapping answers **which things are intentionally the same capability**.

This prevents accidental equality such as:

- a Payload collection being assumed to implement a Blueprint feature;
- an API route being assumed to have a persistence model;
- a code file being assumed to expose a public API;
- a database entity being assumed to be product-visible.

## Green criteria

Step 07 is not green until mapping records are generated from the authoritative inventories and every required relationship is either explicitly mapped or explicitly blocked. Empty records are therefore not green.

## Downstream

Step 08 consumes this mapping to perform deterministic five-way reconciliation.
Step 09 consumes reconciliation output to detect drift and calculate change impact.
Step 10 makes the complete chain CI-enforced.
