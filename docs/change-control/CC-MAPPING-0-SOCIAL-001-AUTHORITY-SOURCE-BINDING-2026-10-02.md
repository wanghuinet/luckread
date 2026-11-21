# Change Control: SOCIAL-001 Existing Authority Source Binding — 2026-10-02

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-AUTHORITY-SOURCE-BINDING-2026-10-02`
- Status: `AUTHORITY-CONTRACT-REFINED / IMPLEMENTATION-BLOCKED`
- Base `main`: `731b8fcf0f91b8e2557f476624eda9a6d1c7c48a`
- Backup: `backup/batch-20261002-before-social-authority-bind`
- Work branch: `codex/social-follow-authority-binding-20261002`

## Binding refined

The existing SOCIAL-001 authority contract now explicitly marks these already-contracted sources as bound:

- authenticated actor principal;
- actor account state (D1-01);
- `social.follow` permission;
- target identity (`ENT-USER`);
- block policy;
- anti-abuse admission;
- W01→W05 caller provenance.

No new authority domain or Worker/D1 is introduced.

## Remaining authority gaps

Only these two operation-level inputs remain unresolved:

1. `targetFollowability`
2. `privacyScopeAllows`

The current repository contains supporting policy references for both, but not a single explicit operation-level decision contract that W05 can consume as authoritative input. This remains a decision boundary and is not inferred.

## Runtime boundary

SOCIAL-001 Follow/Unfollow remains implementation-blocked. No Service Binding configuration, runtime handler, migration, or Evidence Registry PASS is created by this change.

## Mapping effect

SOCIAL-001 stays `PARTIAL`, but the unresolved authority surface is reduced to the two explicit inputs above, plus runtime/test/evidence verification.
