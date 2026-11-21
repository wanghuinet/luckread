# AUTH-013 W06 Runtime Publication / Transport Decision Input — 2026-09-24

- Decision ID: `CC-MAPPING-0-AUTH-013-W06-RUNTIME-PUBLICATION-TRANSPORT-DECISION-INPUT-2026-09-24`
- Feature: `AUTH-013`
- Scope: W02 authoritative account-state transition → `identity.account_state_changed` publication → W06 AuditEvent persistence runtime integration
- Repository authority: GitHub `main`
- Status: **DECISION_INPUT / WAIT_AUTHORITY_DECISION**

## 1. Current verified implementation baseline

The following sub-gates are already verified and are inherited without re-execution because their authoritative inputs and tested scope remain unchanged:

1. W02 AUTH-013 account-state transition kernel
   - Source: `workers/W02-content/src/account/account-state-transition.ts`
   - Run: `35943346415`
   - Result: **PASS_VERIFIED**
   - Tests: **13/13 PASS**
   - Authority: W02 / D1-01.

2. AUTH-013 D1-01 persistence migration
   - D1-01 UUID: `2f80471e-3756-49f9-8db1-7707a433ad64`
   - Run: `35937873769`
   - Result: **PASS_VERIFIED**
   - `account_state` and `account_state_version` are remotely verified.

3. W06 AuditEvent source + runtime boundary
   - Source: `workers/W06-governance/`
   - Source CI Run: `35982576756`
   - Result: **PASS_VERIFIED**
   - TypeScript, constructor, persistence and runtime integration tests all passed.

4. W06 D1-03 AuditEvent schema/migration
   - D1-03 UUID: `bda1d247-a371-4244-91ae-aef96034db7f`
   - Read-only evidence Run: `35975461648`
   - Result: **PASS_VERIFIED**
   - `audit_events`, required fields, immutable UPDATE/DELETE triggers, indexes and migration history are verified remotely.

5. W06 controlled deployment
   - Deployment Run: `35983760891`
   - Source: `b139f541d3a9e4623d2abd2e0e83bfc9864474b2`
   - Worker: `luckread-w06`
   - Version: `ee707166-f437-4f5c-8332-ca39b4ae378e`
   - D1 binding: `env.D1_03` → `secondary`
   - Result: **SUCCESS for Worker/version upload and binding resolution only**
   - Cloudflare reported `No targets deployed for luckread-w06`; HTTP target reachability is therefore not promoted as evidence.

## 2. Missing runtime chain

The repository currently contains:

- W02 authoritative state transition logic;
- W06 canonical AuditEvent constructor;
- W06 D1-03 persistence boundary;
- W06 internal HTTP handler that accepts an already-formed AUTH-013 transition result.

The repository does **not** currently establish an executable producer/transport that connects an accepted W02 account-state transition to W06 publication/persistence.

The repository also does not currently establish the public `transitionAccountState` HTTP transport or W01 route wiring for this operation.

Therefore no end-to-end `identity.account_state_changed` execution evidence exists yet.

## 3. Frozen architecture constraints that block an inferred shortcut

The canonical Worker/D1 rules require cross-D1 mutation to follow:

```text
authoritative transaction
        ↓
outbox / versioned event
        ↓
queue / authorized consumer
        ↓
idempotent transition
        ↓
reconciliation / evidence
```

The same rule is repeated in the active Worker/D1 Binding Mapping, Mapping Freeze, Final Mapping and D1 Domain Master.

Additional active facts:

- D1-03 operational schema includes Outbox / Inbox / IdempotencyRecord as runtime concepts.
- W10 is the canonical Async / Queue / Job Execution boundary.
- W10 may execute queued/background work under the authority of the owning Worker/Task and an approved event contract.
- W02 remains authoritative for D1-01 account state.
- W06 remains authoritative for D1-03 AuditEvent writing.
- No fifth D1, thirteenth Worker, or unrestricted cross-D1 writer may be introduced.

**Therefore this decision input explicitly prohibits implementing a direct synchronous W02 → W06 Service Binding or direct D1-03 write merely to close the current evidence gap.**

That would be an architecture inference rather than an evidence-backed implementation.

## 4. Independent contract-alignment gap: actor type

A second unresolved authority issue exists at the event/audit boundary:

- `contracts/state-machines/account.json` defines some account-state transitions with actor type `operator`.
- `contracts/schemas/common/actor.json` defines the canonical audit Actor enum as:
  `user | service | admin | system | job`.
- W06 AuditEvent source follows the canonical common Actor enum and therefore does not accept `operator`.

No inference is authorized that maps `operator` to `admin` or `service`.

This requires an explicit authority decision before the full account-state → audit publication path can be promoted to contract-compliant runtime evidence.

## 5. Decision questions

Authority is requested only on the following points:

### Q1 — Publication transport

Which already-admitted runtime mechanism is authoritative for `identity.account_state_changed` from W02/D1-01 to W06/D1-03?

The decision must preserve the existing frozen topology and cross-D1 rule. The implementation may use an already contracted Outbox/Event/Queue/Consumer boundary, or another mechanism only if it is already authoritative elsewhere. A new architecture may not be inferred here.

### Q2 — Event consumer ownership

Does the approved consumer boundary belong to the existing W10 Async / Queue / Job execution Worker, or another already-authorized Worker boundary?

No new Worker may be created.

### Q3 — Actor normalization

How should the state-machine `operator` actor be represented at the canonical AuditEvent boundary?

Possible outcomes must be explicitly authoritative; the implementation must not silently normalize one actor type into another.

### Q4 — Public operation transport

**Resolved from existing authority; no new decision is required.**

The canonical operation is already bound to:

- method: `POST`
- path: `/v1/users/{userId}/account-state`
- operationId: `transitionAccountState`
- authoritative business Worker: W02 / D1-01
- public API boundary: W01

The existing W01 → W02 `W02_AUTH` Service Binding is already verified and remains the admitted transport boundary for the W01-to-W02 call. This does **not** prove the AUTH-013 operation itself has runtime evidence, and it does not authorize W01 direct D1-01 writes.

No additional public route is to be added by inference.

## 6. Forbidden actions until the decision is resolved

- Do not add W02 → W06 direct Service Binding solely for AUTH-013.
- Do not make W02 write D1-03 `audit_events` directly.
- Do not create a duplicate AuditEvent table or producer in W02.
- Do not treat W06 `/health` as proof of production reachability while no target is deployed.
- Do not create a public account-state route merely to generate smoke evidence.
- Do not map `operator` to another Actor type by inference.
- Do not add a Worker or D1.
- Do not change the frozen 12-Worker / 4-D1 topology.
- Do not change the existing AUTH-013 Contract/Blueprint in this decision-input step.

## 7. Resolved / unresolved decision status

- **Q1 Publication transport:** UNRESOLVED — an executable event/queue contract connecting the W02 authoritative transition to W06 AuditEvent persistence is not present.
- **Q2 Consumer ownership:** UNRESOLVED — W10 is an execution boundary, but the Worker Master explicitly gives W10 no artificial Primary Task. Its use for AUTH-013 requires an explicit event/task contract rather than inference.
- **Q3 Actor normalization:** UNRESOLVED — `operator` exists in the account-state transition authority but not in the canonical common AuditActor enum. No mapping is authorized.
- **Q4 Public operation transport:** RESOLVED at contract/topology level — W01 public boundary → W02 authoritative operation via the already verified `W02_AUTH` binding. Runtime AUTH-013 execution evidence remains absent.

## 8. Current disposition

**AUTH-013 remains BLOCKED_NOT_GREEN for the downstream runtime publication/integration chain.**

Verified sub-gates stay inherited:

- W02 transition kernel = PASS_VERIFIED.
- AUTH-013 D1-01 schema/migration = PASS_VERIFIED.
- W06 source/runtime persistence boundary = PASS_VERIFIED.
- W06 D1-03 AuditEvent schema/migration = PASS_VERIFIED.
- W06 Worker/version upload + binding resolution = PASS_VERIFIED at upload scope.

Unverified downstream claims:

- accepted transition → event publication;
- event transport/queue execution;
- W06 runtime invocation from the authoritative source;
- persisted `identity.account_state_changed` row from a real transition;
- cache/session/deindex side effects;
- end-to-end security/integration evidence.

**Next state: WAIT_AUTHORITY_DECISION.**

No implementation change is admitted until the transport and actor-type questions are resolved against existing authority.


## 9. Current-head reconciliation findings — 2026-09-24

A read-only current-`main` inspection narrowed the unresolved boundary without changing any authoritative Contract/Blueprint:

1. The cross-cutting event contract already exists at `docs/163-EVENT-SEMANTICS-DELIVERY-ORDERING-REPLAY-DLQ-CONTRACT-v1.0.md`.
   - Canonical event envelope requires `eventId`, `eventType`, `schemaVersion`, producer/resource/correlation/causation metadata, `idempotencyKey`, `attempt`, `sourceVersion` and payload.
   - Delivery is **at-least-once** by default; consumers must be idempotent.
   - The transaction boundary permits a transactional outbox / durable publication boundary / equivalent, but requires durable event intent after the authoritative transition.
   - Cross-domain consumers must not become a second authority.

2. The active D1 Domain Master confirms that D1-03 owns `Outbox`, `Inbox` and operational idempotency records, while preserving the frozen:
   `Authoritative transaction → Outbox/event → Queue/consumer → Idempotent state transition → Reconciliation/evidence`
   pattern.
   This confirms the event semantics, but does **not** identify an executable AUTH-013 producer binding or queue resource.

3. Current W02 source/config was inspected:
   - `workers/W02-content/wrangler.jsonc` binds only D1-01.
   - `applyAccountStateTransition()` currently performs the authoritative D1-01 state/version update and returns the transition result.
   - No Outbox write, event publication call, or W06 transport call is present in that admitted function.
   Therefore an implementation that adds one ad hoc at this stage would be a new cross-domain contract decision, not a routine code completion.

4. The canonical Worker Master still gives W10 no artificial Primary Task, and the current repository search did not identify an executable `workers/W10*` implementation/configuration that could be promoted as an existing runtime boundary by inference.

### Narrowed decision state

- **Q1:** The platform-level event delivery semantics are already authoritative; the remaining unresolved item is the concrete AUTH-013 producer/outbox-to-queue binding.
- **Q2:** Still UNRESOLVED. W10 is an approved execution boundary in architecture, but there is no current executable W10 implementation or task-specific admission establishing this consumer.
- **Q3:** Still UNRESOLVED. `operator` remains outside the canonical common Actor enum; no silent normalization is permitted.
- **Q4:** RESOLVED at contract/topology level as recorded above.

### Admission consequence

No source-code implementation is admitted from this inspection alone. The smallest next artifact is an explicit authority decision that binds the existing event semantics to the AUTH-013 producer/consumer path and resolves the Actor representation. Only after that decision may the corresponding producer/consumer Contract/Blueprint delta be admitted and implemented.
