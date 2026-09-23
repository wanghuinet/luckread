# AUTH-013 — Account-State Authority Decision Input — 2026-09-23

- Status: `DECISION_INPUT — BLOCKED_NOT_GREEN`
- Repository authority: GitHub `main`
- Feature: AUTH-013
- Purpose: isolate and preserve the remaining Contract-First authority gaps that block E6 Runtime-003; this document does **not** choose an authority, rename a Worker, add fields, or authorize runtime implementation.

## Current verified facts

1. `docs/04-WORKER-MASTER-v1.0.md` is the active canonical Worker Master and assigns:
   - W01 = Public API / Gateway / Developer & Admin API Boundary; no primary D1 authority.
   - W02 = Identity / Account / Authorization; primary D1 authority D1-01.
   - W02 owns T01/T02/T03.

2. `contracts/enums/account-state.json` defines the canonical AccountState value set, but currently declares:
   - domain = D1-01;
   - authoritative-writer = `W00`;
   - cache-version-field = `account_state_version`.
   The active Worker Master explicitly treats W00 as historical, so this is an unresolved authority conflict.

3. `contracts/entity/entity-field-contract.v1.json` has verified field records only for the currently verified ENT-USER profile/preferences fields. It does not define canonical Field IDs for:
   - `account_state`;
   - `account_state_version`.
   ENT-SESSION remains `CONTRACTED_NOT_VERIFIED`.

4. `contracts/api/api-inventory.v1.json` requires account-state related public operations including:
   - `POST /v1/accounts/{accountId}/suspend`;
   - `POST /v1/accounts/{accountId}/restore`;
   - `POST /v1/users/{userId}/account-state`.
   The implementation/evidence chain for these operations is not currently resolved to a verified runtime owner.

5. `contracts/alignment/code-evidence-inventory.v1.json` currently records `transitionAccountState` with `implementationStatus=UNRESOLVED`.

6. `contracts/alignment/mapping-batches/AUTH-013-real-evidence-reconciliation.v1.md` explicitly keeps implementation authorization `false` and requires the W00-vs-W02 writer conflict, canonical field IDs, operation bindings, persistence/runtime implementation, and evidence chain to be resolved before AUTH-013 can become GREEN.

## Why this blocks E6 Runtime-003

E6 AUTH-002 layer resolution requires authoritative account-state input before the RoleAssignment global-layer result can be accepted. Until AUTH-013 resolves the source of `account_state` / `account_state_version`, a runtime test that supplies account state from W01, a client body, a custom header, Payload User metadata, or a hard-coded default would cross the existing no-inference boundary.

Therefore:
- `authLogin` / `authRefresh` runtime evidence may be prepared as infrastructure, but it cannot be promoted to AUTH-002 evidence while the account-state authority input remains unresolved.
- No W01 direct business-state implementation is authorized by this document.
- No Payload `User.layer` or duplicate account-state/session entity is introduced.

## Decision inputs that remain open

A Contract-First authority decision must explicitly resolve, as one consistent set:

1. **Authoritative writer** — reconcile the stale `W00` declaration with the current W02 ownership model, or retain W00 only if a new explicit Worker authority decision supersedes the current Worker Master.
2. **Canonical field IDs** — select stable Field IDs for `account_state` and `account_state_version` and bind them to an authoritative Entity record.
3. **Canonical operation bindings** — `transitionAccountState` is now explicitly bound to AUTH-013 at the mapping layer; the separately inventoried suspend/restore routes remain Discovery Drafts and cannot be promoted without their own Contract admission.
4. **Persistence mapping** — bind those fields to the existing D1-01 domain and an explicit owning persistence artifact; do not create a new D1.
5. **Runtime handler/evidence boundary** — only after the remaining authority/field/persistence inputs are resolved, authorize implementation and executable evidence.
6. **E6 dependency statement** — update the E6 runtime admission path so it can consume the resolved account-state authority without inference.

## Non-decisions

This packet does not:
- select W02 merely by inference;
- modify `contracts/enums/account-state.json`;
- add `account_state` to `workers/W01-payload/src/collections/Users.ts`;
- add a new public API;
- create a new Worker or D1;
- promote AUTH-013 or AUTH-002;
- alter any existing Contract semantics.

## Current gate

`AUTH-013 = BLOCKED_NOT_GREEN`

Next admissible action is a normal Contract-First authority decision/reconciliation. After that decision is GREEN, implementation and runtime evidence may proceed under the existing E6 admission/change-control chain.

## Decision-ready resolution matrix

The repository currently provides evidence for the following decision inputs, but no artifact that has formally selected one of the alternatives.

### A. Authoritative writer

**Alternative A — W02 / D1-01**
- Align the account-state authoritative writer with the active Worker Master.
- Existing supporting evidence: the active Worker Master assigns Identity / Account / Authorization to W02 and primary D1 authority to D1-01.
- Existing B01 worker-ownership reconciliation also records W02 as the current Identity / Account / Authorization owner.
- Consequence: the stale `authoritative-writer: W00` contract declaration must be changed through normal Contract-First Change Control.

**Alternative B — retain W00**
- Requires an explicit new authority decision that supersedes the active Worker Master for account-state writes.
- The current repository search did not identify such a superseding authority decision or a current W00 runtime implementation/evidence chain.
- Consequence: W00 cannot be treated as current merely because the enum still contains the old declaration.

No alternative is selected by this packet.

### B. Canonical Field IDs

No canonical Field IDs currently exist for `account_state` or `account_state_version`.

The existing Entity/Field registry uses the `ENT-USER-F-...` namespace for User fields. Candidate identifiers may therefore be recorded for decision purposes, but are **not canonical until explicitly admitted**:
- candidate for `account_state`: `ENT-USER-F-ACCOUNT-STATE`
- candidate for `account_state_version`: `ENT-USER-F-ACCOUNT-STATE-VERSION`

These strings must not be added to the canonical entity-field contract solely by this packet.

### C. Persistence decision boundary

After the writer and Field IDs are admitted, the authoritative persistence artifact must be identified inside existing D1-01 scope. The decision must name the actual table/column mapping from repository evidence or an executed schema/migration result. Payload-generated names must not be inferred from the state contract.

### D. Runtime admission boundary

Only after A-C are formally reconciled may the repository:
1. admit the authoritative transition handler for `transitionAccountState`;
2. bind executable code evidence;
3. add positive/negative/security/integration tests;
4. populate Evidence Registry entries;
5. advance AUTH-013 toward GREEN;
6. unlock the dependent E6 Runtime-003 account-state input.

## Decision output required

A GREEN authority decision should explicitly record:
- selected authoritative writer;
- canonical Field ID for `account_state`;
- canonical Field ID for `account_state_version`;
- authoritative D1-01 persistence artifact and mapping;
- effective date/revision of the decision;
- Change Control record governing the contract update.

Until that output exists, the status remains `DECISION_INPUT — BLOCKED_NOT_GREEN`.



## Subsequent decisions recorded on 2026-09-23

This document remains the historical decision-input packet. Its Field-ID section is superseded by `CC-MAPPING-0-AUTH-013-FIELD-ADMISSION-2026-09-23`, which admitted:
- `ENT-USER-F-ACCOUNT-STATE`
- `ENT-USER-F-ACCOUNT-STATE-VERSION`

Its Worker-authority question is superseded by `CC-MAPPING-0-AUTH-013-AUTHORITY-DECISION-2026-09-23` (W02 / D1-01), and its persistence target is subsequently recorded by `CC-MAPPING-0-AUTH-013-PERSISTENCE-TARGET-2026-09-23`.

The remaining open decision is the existing-user backfill policy recorded by `CC-MAPPING-0-AUTH-013-BACKFILL-DECISION-INPUT-2026-09-23`.
