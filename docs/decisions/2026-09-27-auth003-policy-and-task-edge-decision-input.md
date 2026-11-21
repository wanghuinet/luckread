# AUTH-003 Operation Policy + Contract Task Edge Decision Input

Status: **PROPOSED / NOT_AUTHORIZED / NOT_GREEN**

## Purpose

This decision input closes the repeated discovery loop for the two remaining admission inputs without silently promoting either one to canonical authority:

1. the Feature → Contract Task edge for AUTH-003;
2. the missing AUTH-003 Operation Policy resource/cache/retry/event/queue/anti-abuse fields.

## 1. Contract Task edge

### Established authority

- W02 is the canonical Worker for Identity / Account / Authorization.
- W02 owns T01, T02 and T03.
- D1-01 is the canonical Identity / Account / Access domain.
- AUTH-003 owns the Identity/Credential feature contract and the ENT-IDENTITY / ENT-CREDENTIAL logical entities.

### Current gap

No authoritative Mapping record explicitly binds AUTH-003 to one specific task among T01/T02/T03. Domain naming alone is not admitted as a task assignment.

### Engineering fit assessment

**T01 is the only direct candidate for authority admission** because the current task boundary is Identity / Account-oriented and AUTH-003 is credential lifecycle management. T02 is profile/lifecycle-oriented and T03 is authorization-oriented. This is a fit assessment, not a canonical Mapping change.

### Proposed disposition

- Candidate task edge: **AUTH-003 → T01 → W02 → D1-01**
- Status: **PROPOSED / NOT_AUTHORIZED**
- No other task edge is promoted.
- No implementation path may treat T01 as canonical until a Change Control decision admits it.

## 2. Operation Policy

### Frozen inputs

The following are already contractual and are not reopened:

- operations and routes;
- self authorization;
- `user.credential.read` / `user.credential.manage`;
- Idempotency-Key on mutations;
- deterministic normalization;
- persistence-bound uniqueness;
- public projection `credentialId`, `kind`, `active`;
- security exclusions.

### Existing authoritative precedents

The repository already uses:

- `NO_STORE` for security-sensitive authentication/recovery operations;
- `SINGLE_AUTHORITATIVE_WRITE` for authoritative credential/password mutations;
- bounded D1 budgets;
- one-attempt request retry budgets;
- anti-abuse on authentication/account boundaries.

These are precedents only; they do not currently constitute AUTH-003 authority.

### Proposed minimum profile

The following is the recommended engineering profile for admission review. It is intentionally small and preserves the 12-Worker / 4-D1 cost-first architecture.

| Operation | Proposed resource | Proposed cache | Proposed retry | Proposed event/queue | Proposed anti-abuse |
|---|---|---|---|---|---|
| authCredentialList | BOUNDED_READ; D1 read ≤1; write =0; rows ≤100; RPC=0; outbound=0 | NO_STORE; shared=false; authorizationBoundary=true | maxAttempts=1; clientRetrySafe=true | no event/queue until an explicit event contract exists | required; account/identity/device/endpoint; ALLOW/THROTTLE/CHALLENGE/BLOCK |
| authCredentialAdd | SINGLE_AUTHORITATIVE_WRITE; D1 read ≤2; write ≤1; read rows ≤8; write rows ≤4; RPC=0; outbound=0 | NO_STORE; shared=false; authorizationBoundary=true | maxAttempts=1; clientRetrySafe=true; Idempotency-Key | no event/queue until explicitly contracted | required; account/identity/device/endpoint; ALLOW/THROTTLE/CHALLENGE/BLOCK |
| authCredentialReplace | SINGLE_AUTHORITATIVE_WRITE; D1 read ≤2; write ≤2; read rows ≤8; write rows ≤8; RPC=0; outbound=0 | NO_STORE; shared=false; authorizationBoundary=true | maxAttempts=1; clientRetrySafe=true; Idempotency-Key | no event/queue until explicitly contracted | required; account/identity/device/endpoint; ALLOW/THROTTLE/CHALLENGE/BLOCK |
| authCredentialRemove | SINGLE_AUTHORITATIVE_WRITE; D1 read ≤2; write ≤1; read rows ≤8; write rows ≤4; RPC=0; outbound=0 | NO_STORE; shared=false; authorizationBoundary=true | maxAttempts=1; clientRetrySafe=true; Idempotency-Key | no event/queue until explicitly contracted | required; account/identity/device/endpoint; ALLOW/THROTTLE/CHALLENGE/BLOCK |

### Why this is the minimum profile

- No shared cache is safe to admit because the resource is authorization-bound.
- No synchronous Worker-to-Worker RPC is justified by the current AUTH-003 contract.
- No outbound call or queue is required by the frozen wire contract.
- Mutations are authoritative writes and already carry idempotency semantics.
- D1 budgets are deliberately bounded rather than copied from the historical topology.
- Anti-abuse is retained because credential management changes authentication surface area.
- Event/queue fields remain explicitly unresolved because no AUTH-003 event contract currently authorizes a particular event or task type.

## 3. Authority boundary

This document does **not** modify:

- `contracts/api/auth-operation-policy.v1.json`;
- canonical Mapping;
- entity status;
- migration manifest;
- Worker ownership;
- D1 physical schema;
- Evidence Registry;
- Mapping 0 GREEN.

To become authoritative, the proposed task edge and policy profile require a dedicated Change Control admission.

## 4. Next gate

The next admissible sequence is:

1. capture/admit the real D1-01 schema evidence;
2. admit or reject the proposed T01 edge;
3. admit or reject the proposed Operation Policy profile;
4. only then create the smallest AUTH-003 runtime/persistence implementation slice.

No runtime or migration implementation is authorized by this decision input alone.
