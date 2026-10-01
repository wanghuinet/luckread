# CC-MAPPING-0-SOCIAL-001-FOLLOW-TRUSTED-AUTHORITY-BINDING-2026-10-01

**Status:** AUTHORITY-MAPPING / IMPLEMENTATION-BLOCKED  
**Implementation authorization:** false  
**Repository authority:** GitHub `main`  
**Base main:** `f845ad2faf44e0144d6828e3e4c8f6c98f13f681`  
**Backup branch:** `backup/before-social-follow-authority-binding-20261001`  
**Work branch:** `work/social-follow-authority-binding-20261001`

## 1. Purpose

本 Change Control 只收敛 `SOCIAL-001` Follow/Unfollow 在进入 W05 authoritative mutation 之前所需要的可信权限、账号状态、目标资格、Block、Privacy、Anti-Abuse 与内部调用者来源。

本记录不授权运行时代码，不修改 Worker 配置，不创建 Service Binding，不创建 D1，不执行迁移，不新增公开 API，也不改变 Mapping 0 GREEN 条件。

## 2. Current admitted prerequisites

| Boundary | Current state |
|---|---|
| Feature ownership | SOCIAL-001 → T11 → W05 → D1-02 |
| Public operation | `follow` POST `/social/follows` |
| Public operation | `unfollow` DELETE `/social/follows` |
| DTO | `DTO-SOCIAL-FOLLOW-REQUEST` / `DTO-SOCIAL-UNFOLLOW-REQUEST` |
| Entity | `ENT-SOCIAL-FOLLOW` |
| Physical schema | `social_follow_relationships` |
| W05/D1-02 binding | VERIFIED |
| D1-02 migration | PASS_VERIFIED |
| Runtime Follow handler | NOT ADMITTED |

Evidence remains bounded by the existing feature contracts; none of these facts alone authorizes Follow runtime.

## 3. Authority reconciliation

### 3.1 Actor

`actorUserId` must originate from the W01 authenticated server principal. The public request cannot supply or override it.

Existing authority path:

`W01 Payload authentication → existing W01→W02 session/layer authority`

The existing W01→W02 transport is a reusable authenticated-principal pattern. It does not by itself authorize a new W01→W05 transport.

### 3.2 Account state

`actorAccountState` is authoritative in D1-01 through the existing Account State contract:

`contracts/state-machines/account.json`

The account state is evaluated server-side. A copied state in D1-02, cache, request body, or projection cannot become a substitute authority.

### 3.3 Follow permission

The canonical authorization contract and permission catalog already define the permission:

`social.follow`

Authorization remains based on canonical authorization decision + permission + scope + account state + resource/policy checks. A role name or Payload administrator state alone is not sufficient.

### 3.4 Target identity

`targetUserId` is a public target selector, but the target must resolve against authoritative `ENT-USER`. The client may select the target identifier, but cannot establish the target's account state, followability, privacy, block state, or relationship state.

### 3.5 Target followability

The repository has semantic followability requirements in the Social/Creator contracts, but no current evidence-bound operational resolver/transport is admitted for W05.

Therefore:

`targetFollowability = MISSING_OPERATIONAL_AUTHORITY_BINDING`

No implementation may invent a local copy or silently interpret a profile flag as the authoritative decision.

### 3.6 Block policy

The existing Block/Mute contract makes Block take precedence over Follow and requires server-side account-state, relationship-state, anti-abuse and scope enforcement.

Therefore Block is an existing policy authority, but its decision input has not yet been bound to the SOCIAL-001 trusted admission transport.

### 3.7 Privacy / audience scope

Social contracts require privacy/audience policy to be evaluated server-side before relationship exposure or mutation. The current repository does not contain an admitted W05 operational binding for this Follow input.

Therefore:

`privacyScopeAllows = MISSING_OPERATIONAL_AUTHORITY_BINDING`

No W05 local policy table or cache is introduced to fill this gap.

### 3.8 Anti-abuse

The canonical interaction operation policy already requires pre-write anti-abuse admission with the bounded decision set:

`ALLOW | THROTTLE | CHALLENGE | BLOCK | REVIEW`

However, an evidence-bound admission transport into W05 is not currently admitted.

Therefore:

`antiAbuseAdmission = SOURCE_EXISTS_FOLLOW_TRANSPORT_PENDING`

### 3.9 Caller provenance

The current Follow trusted-input contract already requires:

- `caller`
- `transportVersion`
- `correlationId`

The missing piece is an admitted private W01→W05 transport contract carrying those server-generated values.

## 4. Minimum transport decision material

The minimum logical path is:

```text
public request
    ↓
W01 authentication / server-derived principal
    ↓
trusted admission context
    ↓
W01 → W05 private internal transport
    ↓
W05 Follow/Unfollow authority
    ↓
D1-02 authoritative relation mutation
```

The transport must be private and server-to-server. Its exact Service Binding name, headers, request schema, retry/timeout policy and exact-source provenance must be explicitly admitted before implementation.

The transport must not:

- forward an end-user bearer credential as business authority;
- create a second Identity/Account authority;
- query W02/W06 ad hoc for every Follow request;
- add a new D1;
- add a new Worker;
- add a new public operation;
- turn cache/projection/event state into authorization truth.

The existing operation budget remains authoritative:

- Follow: `d1ReadMax=1`, `d1WriteMax=1`, `rpcMax=0`, at most one async event.
- Unfollow: `d1ReadMax=0`, `d1WriteMax=1`, `rpcMax=0`, at most one async event.

## 5. Admission gate

The current trusted-input contract remains:

`contracts/transport/SOCIAL-001-follow-trusted-admission-input.v1.json`

Its status stays `BLOCKED_NOT_ADMITTED`.

Implementation admission requires all of the following to be evidence-bound:

1. actor account-state authority;
2. target followability authority;
3. Block policy authority;
4. privacy/audience scope authority;
5. anti-abuse admission authority;
6. private W01→W05 transport;
7. exact source SHA provenance;
8. fail-closed negative tests.

Only after those inputs are admitted may the W05 authoritative relation mutation be implemented.

## 6. Next executable slice

The next slice is not the Follow handler itself. It is the smallest remaining Contract-First transport/authority admission package that can bind the existing authority sources without creating another authority.

Expected sequence:

```text
trusted authority source reconciliation
        ↓
private W01→W05 transport contract
        ↓
transport/static validation
        ↓
runtime implementation admission
        ↓
Follow positive / duplicate / unfollow / concurrency / security evidence
```

No step may skip the authority evidence boundary.

## 7. Explicit non-actions

- No Worker topology expansion.
- No D1 topology expansion.
- No Payload Collection.
- No direct W05→W02/W06 policy RPC.
- No new policy store.
- No manual DDL.
- No runtime Follow handler.
- No Mapping 0 GREEN claim.
- No Evidence Registry promotion based on contract text alone.

## 8. Decision

**Continue Contract-First reconciliation. Runtime implementation remains blocked until the trusted Follow authority inputs and private W01→W05 transport are explicitly admitted with exact-source evidence.**
