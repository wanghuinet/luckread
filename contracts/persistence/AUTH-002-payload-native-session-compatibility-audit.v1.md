# AUTH-002 — Payload Native Session Compatibility Audit v1.2

**Status:** `CONTRACT_CLOSED / RUNTIME_EVIDENCE_REQUIRED`

## 1. Purpose

Determine whether Payload's authentication/session implementation can serve as the authoritative implementation of `ENT-SESSION` without introducing a second session authority.

This audit does not promote `ENT-SESSION`, does not create a migration, and does not infer physical schema from framework behavior.

## 2. Locked W01 runtime baseline

1. Runtime authority is `workers/W01-payload/`.
2. W01 follows the official Payload `templates/with-cloudflare-d1` baseline.
3. W01 locks `payload` and `@payloadcms/db-d1-sqlite` to `3.87.1` (current W01 package lock; `3.82.1` remains only the historical upstream template observation).
4. `workers/W01-payload/src/collections/Users.ts` enables `auth: true`.
5. `workers/W01-payload/src/payload.config.ts` configures the D1 adapter, binds the W01 D1 environment, sets `push: false`, and configures `workers/W01-payload/src/migrations` as the migration directory.
6. The repository currently has no verified applied Session migration evidence and no verified runtime equivalence evidence.
7. The canonical Session contract contains nine fields and explicit security/lifecycle invariants.

## 3. Version authority rule

The ordinary Payload release line is not the W01 Cloudflare runtime authority. The current W01 authority is the exact dependency manifest of the official Cloudflare D1 template adopted by `workers/W01-payload`.

Payload release history separately records earlier releases, including the 3.82.1 family observed in the upstream Cloudflare template; that upstream observation must not be substituted for the current W01 runtime baseline (3.87.1) without a new Change Control decision and evidence pass.

## 4. Framework capability evidence

Payload authentication-enabled collections provide native authentication/session operations. Native session capability is therefore a candidate for the single session authority, but framework capability does not prove physical D1 persistence equivalence to the LuckRead canonical nine-field contract.

The W01 D1 adapter also has a documented `upsert` defect observed on the upstream 3.82.1 family affecting preference persistence; with W01 locked to 3.87.1 this remains an explicit runtime regression gate and must be tested on the installed runtime rather than silently worked around by modifying Payload core.

## 5. Canonical compatibility matrix

| Canonical requirement | Payload native evidence | Decision |
|---|---|---|
| Session instance exists | W01 enables native authentication/session capability | Candidate reuse; runtime/schema proof required |
| Stable session identity | Native session identifier is expected to be exposed by runtime flows | Runtime/schema proof required |
| User association | Native session belongs to authenticated user state | Runtime/schema proof required |
| Device association | No verified W01 native `deviceId` equivalence | **BLOCKING** |
| `tokenVersion` | No verified W01 one-to-one native mapping | **BLOCKING** |
| `refreshCredentialHash` | No verified canonical hashed-credential equivalence | **BLOCKING** |
| `expiresAt` | Native authentication has expiration semantics | Candidate reuse; runtime/schema proof required |
| `revokedAt` | Logout invalidation exists, but canonical durable `revokedAt` mapping is not established | Candidate reuse only after proof |
| `createdAt` | Native session metadata exists, but exact canonical mapping is not established | Candidate reuse only after proof |
| `lastSeenAt` | No verified exact W01 native mapping | **BLOCKING** |
| Raw token/password non-persistence | Canonical contract forbids raw secret persistence | Must prove with schema/runtime evidence |
| Revocation authoritative over stale cache | Canonical contract requires fail-closed validation | Must prove by E2E test |
| Refresh replay blocked | Canonical contract requires predecessor invalidation and concurrency safety | Must prove by concurrency test |
| Account-state invalidation | Canonical lifecycle requires immediate invalidation for terminal states | Must prove by runtime test |

## 6. Critical architectural decision

**Do not create a custom `sessions` table at this stage.**

Native Payload session persistence remains the candidate single session authority. Creating a parallel full session table before proving incompatibilities would create two potential authorities and increase migration/runtime complexity.

If evidence proves that a required canonical dimension is unsupported, the unsupported dimension must be documented first. Only then may a minimum integration extension be contracted.

## 7. Required evidence for admission

The W01 `3.87.1` implementation must produce evidence for:

1. actual persisted session representation in D1;
2. session identifier and user association;
3. session expiration and invalidation semantics;
4. refresh behavior and predecessor invalidation;
5. current-session and all-session logout behavior;
6. concurrent refresh race handling;
7. account-state-driven session invalidation;
8. exact location and protection of persisted refresh/session credential material;
9. device binding semantics or a documented unsupported dimension;
10. canonical mapping for each of the nine Session fields;
11. integration/security tests and Evidence Registry execution records;
12. the known D1 `upsert` regression gate.

## 8. Migration gate

The migration gate remains `BLOCKED` until an actual W01 Payload migration artifact exists under `workers/W01-payload/src/migrations` and its applied execution status is evidenced.

Configuration, documented CLI commands, source materialization, or historical files are not execution evidence.

## 9. Current gate

```text
W01 Cloudflare baseline        = 3.87.1 (current lock; upstream observation 3.82.1)
Native session capability      = CANDIDATE / RUNTIME PROOF REQUIRED
Canonical field equivalence    = NOT PROVEN
Actual D1 session schema       = NOT VERIFIED
Migration artifact             = NOT VERIFIED
Applied migration              = NOT VERIFIED
Runtime equivalence            = NOT VERIFIED
Device binding                = BLOCKING
Token-version mapping         = BLOCKING
Last-seen mapping             = BLOCKING
D1 upsert regression          = RUNTIME GATE
ENT-SESSION promotion         = BLOCKED
AUTH-002                      = BLOCKED_NOT_GREEN
```

## 10. Next closure action

Run the W01 version-pinned Payload session runtime/schema evidence pass against the controlled D1 environment. Record concrete findings only. Do not create duplicate session persistence or promote `ENT-SESSION` until the complete evidence chain is closed.
