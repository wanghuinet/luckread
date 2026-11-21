# Pre-Contract Step 2 — Feature Inventory Closure v1.2

Status: **BLOCKED / REBASE REQUIRED**

## Authority

The sole current functional source of truth is `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`.

The previous B01-B20 inventory from `docs/00-LUCKREAD-BLUEPRINT-CLOSURE-v3.0.md` is historical evidence only and MUST NOT be used as the current Contract admission feature inventory.

This step does not add, remove, or reinterpret product capabilities. It reconciles the pre-contract evidence layer to the frozen Blueprint v2.0.

## Objective

Convert the canonical Blueprint v2.0 capability inventory into a contract-admission workset while preserving the already frozen Mapping topology:

- 25 Tasks
- 12 Workers
- 4 D1 Domains
- Feature → Task → Worker → D1 mapping

No Worker, D1, Task, API, entity, field, permission, or implementation authority may be invented by this step.

## Machine-readable admission input

The canonical machine-readable inventory is:

`contracts/alignment/feature-inventory.v1.json`

It MUST be generated only by:

`scripts/build-feature-inventory.mjs`

using:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

The generator admits only explicit Blueprint feature-list items. It does not infer Feature IDs from prose, historical references, URLs, headings, or implementation code, and duplicate Feature IDs fail closed.

## Blocking finding

The previous version of this document used B01-B20 as its authoritative feature inventory. That baseline is superseded by Blueprint v2.0, which defines the canonical feature domains and stable Feature IDs.

The generated `contracts/alignment/feature-inventory.v1.json` is also a required committed CI input. If it is absent, stale, non-reproducible, or modified after regeneration, Step 2 remains BLOCKED.

Therefore the previous B01-B20 readiness table cannot be promoted to Contract GREEN. It must be replaced by a Blueprint-v2.0-derived inventory before downstream Data/API/Payload reconciliation is considered complete.

## Required reconciliation chain

Every Blueprint v2.0 Feature ID must ultimately reconcile through the existing frozen topology:

`Feature ID → Task ID → Primary Worker → D1 / boundary → API operation → Data/entity → Security/scope → Lifecycle/state → Event → Test → Evidence`

A verified Mapping owner does not by itself prove that the API, data, security, lifecycle, event, test, or evidence binding exists.

## Admission rules

1. A Blueprint feature is not Contract GREEN merely because its Feature ID exists.
2. Historical B01-B20 records are evidence/reference only.
3. `MISSING`, `CONFLICT`, `DUPLICATE`, `DRIFT`, `UNRESOLVED`, or `NOT_VERIFIED` remain blocking states.
4. Existing implementation facts without a canonical Blueprint Feature ID remain `EXTRA` until Change Control assigns them.
5. No new product capability may be introduced through this reconciliation step.
6. No Worker or D1 may be added to resolve a mapping gap.
7. No Payload Core modification or implementation admission is authorized by this step.
8. Downstream Contract generation remains blocked until the complete canonical inventory is reconciled.

## Current evidence state

The repository contains the generator, schema, and CI entry points for the Blueprint-derived inventory. The committed generated inventory is still a required admission artifact and must be produced and verified from the current Blueprint before Step 2 can become GREEN.

## Exit criteria

Step 2 becomes GREEN only when:

1. Blueprint v2.0 is the explicit authority.
2. All canonical Blueprint Feature IDs are represented in the generated inventory.
3. The generated inventory is reproducible with zero working-tree drift.
4. Each Feature ID has a stable Task/Worker/D1-or-boundary owner from the frozen Mapping.
5. No historical B01-B20 record remains authoritative.
6. No unresolved Feature ownership/conflict remains.
7. The resulting inventory is accepted by the downstream five-way reconciliation and CI gates.

Until all seven conditions pass, Contract generation and implementation remain blocked.
