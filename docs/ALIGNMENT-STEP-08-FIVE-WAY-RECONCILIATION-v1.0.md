# ALIGNMENT STEP 08 — Five-Way Reconciliation v1.0

## Purpose

Step 08 converts the five evidence planes into a deterministic reconciliation result:

`Feature × DB/Entity × API × Payload × Code`

It consumes inventories and the explicit cross-system mapping. It does not invent mappings.

## Rules

1. Every active Blueprint feature must have exactly one mapping record.
2. A missing mapping is `UNRESOLVED` and blocks green.
3. A mapping status other than `MATCH` or `MAPPED` blocks green.
4. Extra mapping records referencing absent Blueprint features are `EXTRA` and block green.
5. Inventory status must be explicitly acceptable before reconciliation can pass.
6. No semantic, fuzzy, or AI inference is allowed.
7. Evidence references are retained in every reconciliation record.
8. Empty inventories and empty mappings cannot pass.
9. Reconciliation is generated; it is not hand-edited.
10. `GREEN` is a proof result, not a declaration of intent.

## Why the first implementation is intentionally strict

The first gate validates the integrity of the mapping graph before attempting deeper semantic equivalence. This prevents a partially populated system from appearing green merely because several inventories exist.

Later reconciliation iterations may add deterministic checks for:

- entity-to-feature cardinality;
- API operation-to-feature mapping;
- Payload collection/field compatibility;
- persistence evidence;
- implementation evidence;
- permission/state/schema compatibility.

Those checks must consume explicit evidence and must fail closed when evidence is absent.

## Output

`contracts/alignment/five-way-reconciliation.v1.json`

The output contains one record per Blueprint feature plus any extra mapping records, with:

`MATCH / MAPPED / MISSING / EXTRA / DRIFT / CONFLICT / DUPLICATE / UNRESOLVED / BLOCKED`

and a top-level blocker list.

## Gate

The generator exits non-zero unless the complete feature mapping is green and all consumed inventories are in an acceptable discovered state.

This is the prerequisite for Step 09 drift and impact analysis.
