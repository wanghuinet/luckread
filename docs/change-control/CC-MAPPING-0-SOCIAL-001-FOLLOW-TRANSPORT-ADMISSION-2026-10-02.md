# Change Control: SOCIAL-001 Internal W01→W05 Transport Admission — 2026-10-02

- Change Control ID: `CC-MAPPING-0-SOCIAL-001-FOLLOW-TRANSPORT-ADMISSION-2026-10-02`
- Status: `AUTHORITY-CONTRACT-ADMITTED / IMPLEMENTATION-BLOCKED`
- Repository authority: GitHub `main` baseline `ede42217a90cfdc0592a6be2ece636ea84b23a40`
- Backup: `backup/batch-20261002-before-social-transport`
- Work branch: `codex/social-follow-internal-transport-contract-20261002`

## Completed

The private W01→W05 transport boundary for SOCIAL-001 is now explicitly contracted as:

`W05_SOCIAL` → `luckread-w05`.

The contract preserves:

- server-derived principal provenance;
- `X-LuckRead-Caller`;
- `X-LuckRead-Transport-Version`;
- `X-LuckRead-Correlation-Id`;
- no end-user bearer-token forwarding;
- no client-supplied actor authority;
- bounded Follow/Unfollow D1 read/write budgets;
- fail-closed behavior when trusted policy inputs are absent.

The transport contract does not create or configure a Cloudflare Service Binding by itself.

## Remaining blockers

The following authority inputs remain unresolved:

- actor account state;
- target followability;
- block policy;
- privacy/audience scope;
- anti-abuse admission.

Therefore W05 Follow/Unfollow runtime remains implementation-blocked.

## Non-actions

- no new Worker;
- no new D1;
- no Payload Collection;
- no public API;
- no W05 business handler;
- no ad-hoc W05→W02/W06 policy RPC;
- no Mapping 0 GREEN;
- no runtime Evidence Registry PASS.

## Mapping effect

SOCIAL-001 is classified as `PARTIAL` because API, Entity/Field/Persistence and private transport contract edges are now explicitly bound. Runtime/security/lifecycle/test/evidence edges remain open.

## Next gate

```
remaining authority-source binding
→ runtime implementation admission
→ W05 Follow/Unfollow implementation
→ positive / duplicate / missing-unfollow / concurrency / security evidence
→ projection/event convergence evidence
```
