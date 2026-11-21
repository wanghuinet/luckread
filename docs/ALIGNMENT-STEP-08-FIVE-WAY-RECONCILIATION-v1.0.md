# ALIGNMENT STEP 08 — Five-Way Reconciliation v1.1

## Status

**ACTIVE / GATE-ENFORCED / NOT_GREEN**

## Authority

The active functional source of truth is:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

The frozen topology is:

`25 Tasks / 12 Workers / 4 D1 Domains`

Historical B01-B20 reconciliation records may be retained as evidence, but they cannot define current Feature scope or create new ownership.

## Purpose

Convert the five evidence planes into a deterministic reconciliation result:

`Feature × DB/Entity × API × Payload × Code`

It consumes inventories and the explicit cross-system mapping. It does not invent mappings.

## Rules

1. Every active Blueprint Feature ID must have exactly one reconciliation record.
2. A missing mapping is `UNRESOLVED` and blocks green.
3. A mapping status other than `MATCH` or `MAPPED` blocks green.
4. Extra mapping records referencing absent Blueprint features are `EXTRA` and block green.
5. Inventory status must be explicitly acceptable before reconciliation can pass.
6. No semantic, fuzzy, or AI inference is allowed.
7. Evidence references are retained in every reconciliation record.
8. Empty inventories and empty mappings cannot pass.
9. Reconciliation is generated; it is not hand-edited.
10. `GREEN` is a proof result, not a declaration of intent.
11. Reconciliation must preserve the frozen Feature → Task → Worker → D1/boundary topology.
12. Reconciliation may not add a Worker, D1 domain, Task, API authority, or product capability.

## Required inputs

- `contracts/alignment/feature-inventory.v1.json`
- `contracts/alignment/database-entity-persistence-inventory.v1.json`
- `contracts/alignment/api-inventory.v1.json`
- `contracts/alignment/payload-inventory.v1.json`
- `contracts/alignment/code-evidence-inventory.v1.json`
- `contracts/alignment/cross-system-mapping.v1.json`

Missing authoritative inputs are blocking. They must not be manufactured from implementation assumptions.

## Output

`contracts/alignment/five-way-reconciliation.v1.json`

The output contains one record per active Blueprint Feature plus any extra mapping records, with:

`MATCH / MAPPED / MISSING / EXTRA / DRIFT / CONFLICT / DUPLICATE / UNRESOLVED / BLOCKED`

and a top-level blocker list.

## Gate

The generator exits non-zero unless the complete feature mapping is green and all consumed inventories are valid, reproducible, and in an acceptable state.

This is the prerequisite for change-impact analysis and Contract admission.
