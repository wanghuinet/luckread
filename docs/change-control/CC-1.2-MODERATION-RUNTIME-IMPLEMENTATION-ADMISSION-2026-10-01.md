# CC-1.2 Moderation Runtime Implementation Admission — 2026-10-01

**Status: EXECUTION ADMITTED / RUNTIME EVIDENCE PENDING**

Repository: `wanghuinet/luckread`
Base head: `5875eda826d9e774f8d3de12f8e2923f55ac6dd6`

## 1. Decision

The existing moderation contracts are sufficiently explicit to admit the smallest runtime implementation for GOV-003/GOV-004.

This admission authorizes only the existing topology and existing Worker identities:

```
W01 authenticated admin request
  → existing W02 session/layer authority
  → W01 → W06_MODERATION → W06 moderation authority / D1-03
  → W06 → W03_CONTENT_MODERATION → W03 content authority / D1-02
```

No new Worker, D1, public W06 route, direct cross-D1 table access, or replacement of Payload authentication is authorized.

## 2. Authorized implementation scope

1. W01 may add the already-contracted internal `W06_MODERATION` Service Binding to `luckread-w06` and expose only the canonical moderation public paths.
2. W06 may implement the canonical Queue / Case / Decision runtime for:
   - `listModerationQueue`
   - `getModerationCase`
   - `decideModerationCase`
3. W06 may add the additive D1-03 migration required by the approved persistence contract, including the scoped operational idempotency record needed to enforce the already-contracted Idempotency-Key replay/conflict rule.
4. W06 may call the already-contracted private `W03_CONTENT_MODERATION` binding for the exact `PENDING_REVIEW → APPROVED|REJECTED` transition.
5. W03 may add a private moderation-aware adapter on the existing content state transition boundary. W03 remains the sole D1-02 content-state writer.
6. Runtime tests and controlled evidence workflows may be added. Remote deployment and remote D1 mutation remain separately controlled and evidenced.

## 3. Security boundary

- W01 remains the public authentication edge.
- W06 derives reviewer identity/layer/scope from trusted server-side context.
- End-user bearer credentials are not forwarded to W06 or W03 as authority credentials.
- W06→W03 accepts only the W06 caller marker, transport version, server-derived principal metadata, moderation decision provenance, If-Match and Idempotency-Key.
- Client-provided reviewer identity, layer, permission, raw evidence and internal risk thresholds are non-authoritative.
- W03 rejects public access to its internal moderation boundary.

## 4. D1-03 migration admission

The source migration may be authored and statically validated as an additive migration against the existing D1-03 allocation:

- database UUID: `bda1d247-a371-4244-91ae-aef96034db7f`
- display name: `secondary`
- target: `moderation_cases`, `moderation_decisions`, scoped moderation decision idempotency records.

Remote application of the migration is not executed by this change control. It requires the dedicated manual migration workflow and its post-migration evidence.

## 5. Required evidence before runtime GREEN

The following remain open until executable evidence exists:

- exact W01/W06/W03 source SHAs and deployed Worker versions;
- W01→W06 binding deployment evidence;
- W06→W03 binding deployment evidence;
- authenticated principal and reviewer-layer propagation;
- permission and reviewer-scope negative tests;
- Queue/Case/Decision positive runtime;
- 401/403/409/412/428 negative behavior;
- Idempotency-Key replay and key-reuse conflict;
- W06 decision → AuditEvent one-to-one evidence;
- W06 decision → W03 content transition evidence for APPROVED and REJECTED;
- stale target/case version rejection;
- D1-03 migration and remote schema evidence;
- no Authorization header forwarding;
- no direct W06→W03 D1-02 access;
- correlation/requestId preservation.

## 6. Non-actions

This admission does not claim:

- production deployment;
- remote D1 migration execution;
- runtime GREEN;
- Mapping 0 GREEN;
- feature-wide moderation completion;
- new infrastructure outside the frozen 12 Worker / 4 D1 topology.

## 7. Reconciliation

The implementation may now proceed against the existing contracts. Evidence status remains open until the controlled CI/deployment/evidence channels produce current-head proof.
