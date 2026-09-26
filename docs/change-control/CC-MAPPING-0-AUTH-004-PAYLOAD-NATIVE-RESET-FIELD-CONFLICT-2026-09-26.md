# CC-MAPPING-0-AUTH-004-PAYLOAD-NATIVE-RESET-FIELD-CONFLICT-2026-09-26

- Feature: `AUTH-004`
- Scope: W01 Payload native authentication persistence versus AUTH-004 recovery-token persistence rules
- Status: `DECISION_APPROVED`
- Implementation authorization: `true` (W01 containment + W02 AUTH-004 implementation only)
- Runtime authorization: `false`
- Mapping-0 promotion: `false`

## 1. Observed repository fact

The current W01 Payload migration `workers/W01-payload/src/migrations/20250929_111647.ts` creates the native `users` table with:

- `reset_password_token`
- `reset_password_expiration`

The current `workers/W01-payload/src/collections/Users.ts` enables Payload authentication with `auth: true`.

W01 pins Payload `3.87.1` in `workers/W01-payload/package.json`.

## 2. Runtime behavior is now externally confirmed

This is no longer only a schema-presence observation.

Payload `v3.87.1` source confirms that the built-in forgot-password operation:

1. generates a raw reset token using `crypto.randomBytes(20).toString('hex')`;
2. persists that raw token as `resetPasswordToken`;
3. persists `resetPasswordExpiration`;
4. sends the raw token into the reset link / email generation path.

Payload `v3.87.1` source also confirms that the built-in reset-password operation:

1. queries `resetPasswordToken = data.token`;
2. validates `resetPasswordExpiration`;
3. updates the password;
4. creates a new session.

Payload `v3.87.1` also exposes the built-in REST paths:

- `POST /api/{user-collection}/forgot-password`
- `POST /api/{user-collection}/reset-password`

Evidence sources:

- Payload v3.87.1 forgot-password implementation:
  `https://github.com/payloadcms/payload/blob/v3.87.1/packages/payload/src/auth/operations/forgotPassword.ts`
- Payload v3.87.1 reset-password implementation:
  `https://github.com/payloadcms/payload/blob/v3.87.1/packages/payload/src/auth/operations/resetPassword.ts`
- Payload v3.87.1 built-in auth endpoints:
  `https://github.com/payloadcms/payload/blob/v3.87.1/packages/payload/src/auth/endpoints/index.ts`

Therefore the existing Payload-native recovery path is materially incompatible with the current AUTH-004 invariant if that path is used for canonical recovery.

## 3. AUTH-004 authority

The authoritative AUTH-004 persistence contract requires:

- raw reset token absent from persistence;
- recovery token represented only by derived material (`tokenHash`);
- purpose, issue/expiry, single-use consumption and invalidation state persisted;
- recovery challenge bound to identity;
- successful reset/change invalidates affected sessions;
- green requires executable persistence/runtime evidence.

Canonical source:

`contracts/entity/AUTH-004-password-recovery-field-contract.v1.json`

Migration target:

`MIG-AUTH-004-PASSWORD-RECOVERY-V1` in `contracts/migration/AUTH-002-006-migration-manifest.v1.json`

## 4. Conflict boundary

The conflict is now classified as both:

- a physical schema-authority conflict; and
- a confirmed built-in runtime recovery behavior conflict.

The unresolved question is:

> What is the admitted integration boundary that prevents the canonical AUTH-004 flow from using Payload's raw-token reset implementation, while preserving the required W01 local-auth capabilities and avoiding an unauthorized Payload-core fork?

No automatic answer was admitted before decision. The decision is recorded in Section 15 below.

## 5. Required decision material

Before implementation or migration execution, resolve all of the following:

1. Whether Payload's native reset-password fields and built-in recovery handlers are authoritative, legacy/inert, or forbidden for canonical AUTH-004.
2. Whether the native recovery endpoints must be disabled, isolated, bypassed, or otherwise prevented from serving canonical AUTH-004 traffic.
3. Whether W01 can achieve that boundary through supported Payload configuration or collection/runtime extension points without modifying Payload core.
4. Whether any retained physical legacy columns are acceptable only when proven unreachable and never populated by the canonical application path.
5. If the native fields/handlers must be removed or superseded, define migration/change order and backward-compatibility/recovery requirements.
6. Define executable evidence proving raw recovery tokens are never persisted or logged by the canonical AUTH-004 path.

## 6. Candidate resolution tracks (decision material only)

These were candidate resolution tracks before decision; Section 15 selects the admitted track.

- **Track A — Isolate native recovery**: keep Payload local auth for login/session capability, but explicitly prevent the native forgot/reset endpoints and operations from being the canonical recovery surface.
- **Track B — Adapt at the W01 boundary**: use supported Payload extension/configuration points to route canonical AUTH-004 recovery through a separate persistence model while preventing the built-in raw-token path.
- **Track C — Payload-core modification/fork**: modify or maintain a controlled fork of Payload authentication internals. This has higher governance/maintenance impact and therefore requires explicit architecture/change-control admission before use.

The repository MUST follow the decision recorded in Section 15; Track B and Track C are not admitted by this Change Control.

## 7. Evidence anchors

- W01 package version: `workers/W01-payload/package.json`
- W01 migration: `workers/W01-payload/src/migrations/20250929_111647.ts`
- W01 auth collection: `workers/W01-payload/src/collections/Users.ts`
- AUTH-004 field contract: `contracts/entity/AUTH-004-password-recovery-field-contract.v1.json`
- AUTH migration manifest: `contracts/migration/AUTH-002-006-migration-manifest.v1.json`
- Existing schema evidence also records `reset_password_token` / `reset_password_expiration` in the controlled AUTH baseline artifacts.

## 8. Gate impact

The conflict is resolved at the architecture/change-control level by Section 15, but implementation and runtime evidence remain gated:

- AUTH-004 persistence remains `CONTRACTED_NOT_VERIFIED`.
- AUTH-004 Evidence Registry admission remains blocked.
- No raw-token runtime implementation may be inferred from Payload-native reset support.
- No migration execution may be claimed.
- No Mapping-0 GREEN may be claimed from this Change Control.
- No Payload-core modification may be introduced without explicit change-control authorization.

## 9. Supported configuration boundary audit

Payload v3.87.1 sanitizes an auth-enabled collection by appending the complete built-in `authCollectionEndpoints` set, which includes both `POST /forgot-password` and `POST /reset-password`.

The collection-level `endpoints: false` switch disables the collection endpoint surface as a whole; it is not a per-auth-operation switch and would also suppress the collection's normal REST endpoints.

No repository evidence has yet established a supported Payload configuration knob that disables only the native forgot/reset handlers while retaining the rest of the local authentication surface.

This narrows the current decision material: the canonical AUTH-004 boundary cannot be assumed to be achieved by a simple per-operation Payload configuration flag.

## 10. Inherited canonical Worker authority

Existing resolved Worker ownership is authoritative for current implementation binding:

- W01 = Public API / Gateway / Developer & Admin API Boundary; no direct authoritative D1 ownership.
- W02 = Identity / Account / Authorization; D1-01 identity/account/authorization authority.
- W01 must route authoritative identity/account operations to the owning Worker and must not become the business authorization/session/database owner.

These values are inherited from the resolved `M0-B01-WORKER-OWNERSHIP-RECONCILIATION-AUDIT-2026-09-20` and the active Worker Master / Worker × D1 Binding Mapping.

Therefore the canonical AUTH-004 implementation boundary is W02 / D1-01, not the W01 Payload implementation surface. This does **not** authorize AUTH-004 runtime implementation; it only fixes the ownership boundary already established by the active architecture.

The remaining W01 issue is an exposure/containment decision: Payload's built-in recovery endpoints and raw-token persistence exist inside the W01 Payload surface and must not be allowed to become the canonical AUTH-004 recovery path.

No new Worker, D1 domain, or ownership edge is created by this clarification.

## 11. Supported containment mechanism now confirmed at Payload v3.87.1 source level

A supported collection-level boundary is now confirmed and narrows the decision material without selecting the final architecture track:

1. `forgotPassword` calls Payload's `buildBeforeOperation` with operation `forgotPassword` before generating or persisting the native reset token.
2. `resetPassword` calls the same `buildBeforeOperation` with operation `resetPassword` before querying or consuming the native raw-token fields.
3. Payload's `OperationMap` and `operationToHookOperation` explicitly include both operations in the collection `beforeOperation` hook contract.
4. The hook runner awaits each registered `beforeOperation` hook and propagates a thrown error; the native operation therefore cannot continue after a fail-closed hook rejection.
5. The Payload documentation confirms collection-level `beforeOperation` hooks are supported extension points, while `endpoints: false` disables the entire collection endpoint surface rather than only password-recovery routes.

Source anchors:

- `packages/payload/src/auth/operations/forgotPassword.ts` at Payload v3.87.1
- `packages/payload/src/auth/operations/resetPassword.ts` at Payload v3.87.1
- `packages/payload/src/collections/operations/utilities/buildBeforeOperation.ts` at Payload v3.87.1
- `packages/payload/src/collections/operations/utilities/types.ts` at Payload v3.87.1
- Payload collection configuration / hooks documentation

This establishes that the repository has a supported, fail-closed interception point for the native recovery operations without requiring `endpoints: false` or a Payload-core fork.

This is **decision material only**. It does not yet authorize implementation, does not select Track A/B/C, and does not establish that the hook has been installed in W01. The remaining decision is whether the admitted integration boundary should explicitly install this fail-closed guard and how that boundary is reconciled with the canonical W02/D1-01 AUTH-004 flow and any retained legacy columns.
## 12. Current W01 containment status

The current W01 repository state has **not** installed the fail-closed hook boundary described above:

- workers/W01-payload/src/collections/Users.ts sets auth: true but declares no hooks.beforeOperation guard.
- workers/W01-payload/src/payload.config.ts does not install a recovery-specific collection hook or endpoint-level blocker.
- The existing W01 native migration still creates users.reset_password_token and users.reset_password_expiration.
- Therefore the repository currently has a confirmed supported interception mechanism, but the protection is **not yet implemented; implementation is now authorized under Section 15**.

This distinction is deliberate:

- **Capability confirmed:** Payload v3.87.1 exposes an awaited beforeOperation interception before native forgot/reset token processing.
- **Project containment absent:** current W01 code does not yet use that interception.
- **Canonical AUTH-004 owner unchanged:** W02 / D1-01 remains the authoritative implementation boundary.
- **Implementation gate unchanged:** no runtime or migration work is authorized by this finding alone.

Any future implementation admission must specify, at minimum:

1. the exact W01 hook behavior for forgotPassword and resetPassword;
2. the failure semantics proving the native operation cannot continue;
3. the relationship between the W01 guard and the canonical W02 AUTH-004 endpoints;
4. whether retained native reset columns are legacy/inert and how that is proven;
5. the runtime evidence proving neither canonical nor accidentally reachable native recovery paths persist raw reset tokens.

Until those items are explicitly admitted, the Change Control remains BLOCKED_DECISION_REQUIRED.
## 13. Minimum implementation and acceptance packet for a future admission

This section is a decision/acceptance packet only. It does not authorize implementation.

### 13.1 Minimum W01 containment surface

Under the approved Track A decision, the smallest repository surface to inspect/change is:

- workers/W01-payload/src/collections/Users.ts
- workers/W01-payload/src/payload.config.ts only if the chosen hook wiring requires shared construction/configuration
- a focused W01 hook/helper module if keeping security policy out of the collection declaration is preferred
- W01 tests covering native forgot/reset interception

No Payload core file is required by the currently confirmed mechanism.

### 13.2 Required native-operation behavior

For both native operations:

- forgotPassword
- resetPassword

the containment guard must fail closed before the Payload native operation can generate, persist, query, or consume resetPasswordToken.

The guard must not forward the caller into the Payload native recovery implementation.

The guard must not create or return the canonical AUTH-004 recovery token itself.

The canonical recovery flow remains the W02/D1-01 AUTH-004 boundary.

### 13.3 Required negative evidence

Admission should require executable evidence for at least:

1. native forgot-password request cannot persist reset_password_token;
2. native reset-password request cannot consume a Payload native reset token;
3. canonical AUTH-004 stores only tokenHash/derived recovery material;
4. raw recovery token is absent from D1 persistence after reset-request;
5. raw recovery token is absent from application logs/test artifacts;
6. expired token is rejected;
7. replayed token is rejected;
8. wrong-purpose token is rejected;
9. successful password reset invalidates the affected sessions;
10. canonical W02 flow remains reachable through the admitted API boundary.

### 13.4 Legacy-column decision requirement

The existing users.reset_password_token and users.reset_password_expiration columns are a separate schema decision.

The decision must explicitly classify them as one of:

- retained legacy/inert columns with proof they are unreachable and remain unpopulated by the canonical runtime;
- superseded columns with an admitted migration/removal sequence; or
- another explicitly approved authority state.

No implementation may infer this classification from mere absence of application references.

### 13.5 Gate ordering

After an explicit Change Control decision, the expected order remains:

Change Control decision
→ contract/reconciliation update if required
→ W01 containment implementation
→ W02/D1-01 AUTH-004 implementation
→ migration
→ isolated runtime/persistence tests
→ exact-commit evidence
→ Evidence Registry admission
→ Mapping 0 / downstream gates.

A failing upstream gate does not authorize a later step.
## 14. Current W02 canonical implementation status

The current W02 repository state confirms ownership infrastructure but does not contain an AUTH-004 password-recovery implementation:

- workers/W02-content/src/index.ts currently exposes internal session establish/refresh/revoke and authz layer routes; no canonical AUTH-004 password change/reset-request/reset-confirm route is present.
- workers/W02-content/migrations currently contain role-assignment, AUTH-013 account-state/publication-journal, and role-authorization-version migrations; no MIG-AUTH-004-PASSWORD-RECOVERY-V1 implementation is present.
- Repository search found the AUTH-004 persistence fields only in contract/change-control material, not as an existing W02 runtime implementation.

This is a current code-state finding; implementation authorization is now governed by Section 15.

It confirms the present boundary is:

W01 = existing Payload local-auth surface with native recovery behavior that is currently uncontained.
W02/D1-01 = canonical AUTH-004 ownership, but AUTH-004 runtime implementation is not yet present.

Therefore the project is not currently in a state where a canonical AUTH-004 runtime path can be proven end-to-end. The next implementation gate must separately admit W01 native-recovery containment and W02 canonical recovery implementation.


## 15. Final Change Control Decision — 2026-09-26

### 15.1 Decision

Track A — Isolate Payload native recovery is APPROVED.

The canonical password recovery system is W02 / D1-01 under AUTH-004.

Payload native forgotPassword and resetPassword operations are not authoritative and MUST NOT serve as the canonical recovery path.

W01 SHALL retain Payload local-auth capabilities required by the existing architecture, but SHALL fail closed before the native recovery operations can generate, persist, query, or consume resetPasswordToken.

### 15.2 Exact containment boundary

The approved containment mechanism is the existing supported Payload v3.87.1 collection beforeOperation hook boundary.

For both operations — forgotPassword and resetPassword — the W01 hook MUST reject the native operation before native reset-token processing begins.

The native operation MUST NOT be allowed to continue after the guard rejects it.

The native route MUST NOT be adapted to become an alternative implementation of AUTH-004.

No Payload-core modification or fork is approved.

For the native endpoints, the rejection should use a non-recovery public error surface; the implementation should prefer a not-found style response where supported, with no reset-token, delivery, account-existence, or persistence metadata disclosed.

### 15.3 Canonical flow

The canonical flow is:

public /auth/password/* boundary → W01 API/gateway boundary → W02 Identity / Account / Authorization → D1-01 authoritative persistence → AUTH-004 recovery state machine and session invalidation.

W01 Payload native /forgot-password and /reset-password are containment-only legacy surfaces and MUST NOT enter this canonical flow.

### 15.4 Native columns decision

The existing Payload columns users.reset_password_token and users.reset_password_expiration are approved as retained legacy/inert columns for the initial containment phase.

They are not part of AUTH-004 authority.

They MUST remain unpopulated by the canonical recovery path.

A later removal migration is not required to unblock the first AUTH-004 runtime implementation; removal becomes a separate destructive Change Control item only if repository/runtime evidence later justifies it.

This is deliberately the least-destructive migration choice because Payload auth:true currently expects these native fields in its generated authentication schema, while the approved hook prevents the native recovery operations from using them.

### 15.5 W02 implementation authorization

W02 implementation is authorized only for the already-contracted AUTH-004 operations and persistence rules.

The implementation MUST use recoveryId, identityId, purpose=password_reset, tokenHash, issuedAt, expiresAt, consumedAt, and invalidatedAt together with the canonical credential/session contracts.

Raw recovery tokens MUST NOT be persisted or logged.

Successful password reset/change MUST perform the required session invalidation according to the existing session lifecycle contract.

### 15.6 Explicitly not approved

This Change Control does NOT approve:

- Payload-core fork/modification;
- W01 becoming the authoritative recovery persistence owner;
- storing the raw recovery token in users.reset_password_token;
- exposing Payload native recovery as an alias for AUTH-004;
- creating a new Worker or D1 domain;
- bypassing Mapping-0 / Evidence Registry / runtime gates;
- claiming GREEN from this decision alone.

### 15.7 Promotion state after decision

After this decision:

- W01 containment implementation: AUTHORIZED
- W02 AUTH-004 implementation: AUTHORIZED
- AUTH-004 migration execution: NOT YET AUTHORIZED
- production/remote runtime execution: NOT YET AUTHORIZED
- Evidence Registry admission: NOT YET AUTHORIZED
- Mapping-0 promotion: NOT GREEN / NOT AUTHORIZED

Required sequence remains:

Decision → W01 containment → W02 AUTH-004 implementation → contract/implementation reconciliation → isolated schema/migration preparation → separate migration authorization → runtime evidence → Evidence Registry admission → Mapping-0/downstream promotion.
## 16. Password credential compatibility decision — 2026-09-26

AUTH-004 password change/reset MUST remain compatible with the existing Payload local-login verifier while Payload remains pinned at v3.87.1.

Decision:

- The logical AUTH-004 passwordHash remains the credential authority.
- Its current physical compatibility representation is the existing Payload users.hash + users.salt fields.
- W02 / D1-01 is the authoritative writer for password credential changes.
- W01 Payload local authentication remains a reader/verifier of that same credential material.
- No second password hash table or alternate login credential authority is created.

For Payload v3.87.1, the compatibility algorithm is fixed to the currently verified implementation:

- cryptographically random 32-byte salt;
- salt stored as lowercase hexadecimal;
- PBKDF2-HMAC-SHA256;
- 25,000 iterations;
- derived length 512 bytes;
- derived hash stored as lowercase hexadecimal.

This compatibility choice exists to preserve the already-deployed Payload local-login behavior. It does not authorize using the Payload native forgot/reset operations.

W02 MUST enforce the canonical AUTH-004 password policy independently of Payload's native recovery validator before generating the compatible hash/salt representation.

Any future Payload version upgrade that changes the local credential algorithm requires a separate Change Control reconciliation before changing this representation.

This decision does not change the logical Worker ownership: W02/D1-01 remains the authoritative credential writer, and W01 remains the API/Payload edge.

