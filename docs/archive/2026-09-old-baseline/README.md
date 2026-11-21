# Archived Baseline — 2026-09

This directory contains historical planning, contract, audit, API-inventory, and phase documents from the pre-v2 blueprint workflow.

## Source of truth

The active functional source of truth is:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

Archived documents are historical/reference material only. They MUST NOT override the v2.0 blueprint for new feature, API, contract, implementation, or acceptance decisions.

## Archive policy

- Preserve historical documents rather than deleting them.
- Do not use archived gap/audit counts as the current implementation backlog.
- Reuse technically valid material only after reconciling it against the v2.0 blueprint.
- New capabilities must receive a stable Feature ID in the v2.0 blueprint before implementation.
- Implementation proceeds in batches; discussion-only audit loops are not the delivery mechanism.

## Migration rule

When an archived document contains still-valid requirements, migrate the requirement into the v2.0 blueprint first. The migrated Feature ID becomes the authoritative reference; the archived document remains evidence of historical design.
