# Change Control Amendment: SOCIAL-001 Follow Permission Vocabulary — 2026-10-02

- Status: `CONTRACT-FIRST / ADMITTED`
- Base main: `ede42217a90cfdc0592a6be2ece636ea84b23a40`
- Work branch: `codex/social-follow-internal-transport-contract-20261002`

## Finding

The canonical machine-readable permission catalog and OpenAPI operation policy use:

`social.follow`

The detailed Interaction operation policy still used the stale label `interaction.follow`.

## Correction

The Follow and Unfollow detailed interaction policy operations now reference `social.follow`.

No operationId, Entity, Worker, D1 or API path is changed.

The historical 2026-09-30 reconciliation record is retained unchanged for audit provenance; this amendment is the current authority correction.

## Gate impact

This correction removes a direct permission-vocabulary conflict for the active Follow operations. SOCIAL-001 remains PARTIAL and runtime-blocked until the remaining trusted authority inputs and executable evidence are admitted.
