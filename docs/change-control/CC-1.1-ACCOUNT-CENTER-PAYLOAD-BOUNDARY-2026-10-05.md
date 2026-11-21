# CC-1.1-ACCOUNT-CENTER-PAYLOAD-BOUNDARY-2026-10-05

## Status

`DECISION RECORDED / 1.1 FRAMEWORK AMENDMENT`

## 1. Decision

LuckRead 1.1 adopts the following final authority split:

```text
W02 / Better Auth
    = Platform Identity / User Center / Account / Session / Credential / Authorization

W08
    = Creator / Organization / Creator Qualification / Creator-side collaboration

W03 / Payload content boundary
    = Content / Article / Media / Translation / CMS production state

W06
    = Rights / Trust & Safety / Governance / Moderation authority

W07
    = Subscription / Commerce / Payment / Advertising / Financial authority

W12
    = External Developer / Integration execution
```

Payload is therefore a **content implementation boundary**, not the platform identity authority.

## 2. User Center

The canonical platform user is owned by W02 and persisted in D1-01.

Better Auth is the authentication framework and W02 is the account/authorization authority.

The following are W02-owned:

- User
- Identity
- Credential
- Session
- Verification
- Device / security state
- Account State
- Role Assignment
- Entitlement / authorization inputs
- account lifecycle and recovery

The platform MUST NOT create a second competing login/password/session authority in Payload.

## 3. Payload Boundary

Payload remains responsible for content/CMS concerns only.

Payload User may exist as a **local CMS access or creator projection** when Payload requires editor/admin relationships, but:

- it is not the platform identity source of truth;
- it does not own platform login;
- it does not own platform session state;
- it does not define the canonical L1-L8 layer;
- it must bind to the canonical W02 identity with an immutable `authUserId`;
- public account APIs must not expose Payload persistence as the platform user model.

No bidirectional identity synchronization is required.

## 4. L1-L8 Permission Model

L0 remains the anonymous/public baseline. L1-L8 are the authenticated/operational permission layers used by 1.1.

| Layer | Canonical meaning | Typical roles |
|---|---|---|
| L1 | Registered / unverified user | `user` |
| L2 | Verified platform user | `verified_user` |
| L3 | Creator | `creator` |
| L4 | IP / organization principal | `ip_principal`, `mcn_admin`, `mcn_editor` |
| L5 | Platform operator | `operator`, `editor` |
| L6 | Moderator / Trust & Safety | `moderator` |
| L7 | Platform administrator | `admin` |
| L8 | Platform super administrator | `super_admin` |

The canonical layer semantics remain defined by `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md` and `contracts/authz/layers.json`.

### Authorization rule

A layer is **not** a role and does not bypass:

```text
Identity
→ Account State Gate
→ DENY
→ Role / Permission
→ Entitlement / Subscription
→ Organization / IP scope
→ Temporary Delegation
→ Resource Ownership / Scope
→ requested resource + action
```

The client MUST NOT select or elevate its own layer.

## 5. 1.1 Worker Authority

This amendment conforms to the frozen 12 Worker / 4 D1 / 25 Task topology.

Relevant boundaries:

- W01 = public API / gateway boundary
- W02 = identity / account / authorization
- W03 = content / article / media / translation
- W06 = rights / trust & safety / governance
- W07 = commerce / payment / advertising
- W08 = creator / organization
- W12 = external developer / integration

No new Worker or D1 is introduced by this amendment.

## 6. Migration / Compatibility Rule

Because the repository currently has no real end-user population requiring account migration, new production identity data is admitted directly into the W02 / Better Auth authority.

Existing Payload users MUST NOT be promoted to the platform identity authority by inference.

Any future migration of an existing populated environment requires a separate Change Control covering:

- identity matching;
- credential migration;
- session invalidation;
- stable user IDs;
- linked identity reconciliation;
- rollback and evidence.

## 7. 1.1 Acceptance Boundary

The framework is considered structurally aligned only when:

- W02 is the sole platform identity/account authority;
- Payload is content/CMS only;
- Creator qualification remains W08-owned;
- L1-L8 resolve through the canonical authorization contract;
- no public path trusts Payload User as a substitute for W02 identity;
- no new Worker/D1 is introduced.

This change is an architecture/framework decision. It does not declare runtime GREEN.
