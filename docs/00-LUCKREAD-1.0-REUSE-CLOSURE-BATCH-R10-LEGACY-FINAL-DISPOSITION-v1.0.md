# LuckRead 1.0 Reuse Closure — Batch R10 Legacy / Temporary Patch Final Disposition v1.0

> Status: **CLOSED / LEGACY DISPOSITION LOCKED / 1.0 REUSE CYCLE COMPLETE**

## 1. Objective

R10 is the final batch of the bounded 1.0 reuse closure. Its purpose is to stop historical documents, obsolete API assumptions and temporary implementation ideas from silently becoming a second source of truth.

The current functional authority remains:

`docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`

The repository's frozen blueprint explicitly states that historical documents remain archived/reference material and do not override the frozen blueprint. fileciteturn341file0

## 2. Final disposition model

Every 1.0 artifact is classified as one of:

```text
DIRECT-REUSE
ALREADY-ABSORBED
REFACTOR
MERGE
REPLACE
ARCHIVE-REFERENCE
REJECT
```

No artifact may remain implicitly authoritative.

## 3. Disposition rules

| Legacy asset type | Disposition | Rule |
|---|---|---|
| Mature domain semantics | DIRECT-REUSE | Reuse only after current Feature ID/Contract alignment |
| Mature state-machine semantics | DIRECT-REUSE / MERGE | Current machine-readable contract is implementation authority |
| Mature authorization semantics | DIRECT-REUSE | Reuse through current AUTHZ boundary |
| Mature ownership / rights semantics | DIRECT-REUSE | Reuse through current RIGHTS/CONTENT boundary |
| Mature financial semantics | DIRECT-REUSE / MERGE | PAY remains sole financial authority |
| Mature event/retry/idempotency rules | DIRECT-REUSE | Reuse through current JOB/EVENT contracts |
| Legacy database tables | REJECT | Do not copy old persistence schema |
| Legacy API paths | REJECT | Do not preserve obsolete paths merely for reuse |
| Obsolete Payload implementation | REJECT | Rebuild against supported Payload extension points |
| Partial implementation | REFACTOR | Bring it under current Contract before reuse |
| Temporary patch / workaround | REFACTOR or REPLACE | Must not become architecture |
| Historical audit report | ARCHIVE-REFERENCE | Evidence of prior state, not current authority |
| Historical blueprint pass | ARCHIVE-REFERENCE | Cannot override v2.0 blueprint |
| Superseded architecture contract | ARCHIVE-REFERENCE | Current canonical contract wins |
| Duplicate conceptual contract | MERGE / REPLACE | One canonical authority per concern |
| Unsupported duplicate authority | REJECT | No parallel identity/AuthZ/PAY/rights/analytics authority |

The existing enhancement matrix already prohibits copying legacy tables, API paths or obsolete Payload implementation and requires reuse through current contracts. fileciteturn325file0

## 4. Historical documents

Historical documents are **not deleted merely to make the repository look clean**.

They remain available for:

- provenance;
- prior design decisions;
- audit history;
- migration reasoning;
- evidence reconstruction.

But every implementation reference must resolve to the current canonical source.

The final blueprint freeze explicitly establishes this hierarchy: historical documents remain archived/reference material and cannot override the frozen blueprint. fileciteturn341file0

## 5. Superseded architecture documents

Where a newer canonical contract explicitly supersedes or reconciles an older architecture document, the older document becomes reference-only.

Example:

```text
300-ARCHITECTURE-BASELINE...
        |
        +--> canonical W00-W08 / D1 / R2 / Cache boundary
        |
        +--> older PAYLOAD-BOUNDARY document = split-trigger reference
```

The newer architecture baseline explicitly records this reconciliation and keeps the older document for its split-trigger semantics rather than allowing two competing architecture authorities. fileciteturn337file0

## 6. Temporary patches

A temporary implementation may only survive if it is explicitly converted into one of:

```text
CANONICAL IMPLEMENTATION
SUPPORTED ADAPTER
TEST FIXTURE
MIGRATION STEP
```

Otherwise it must be removed before the corresponding feature is considered implemented.

The frozen implementation rules already prohibit temporary patches from becoming architecture and require partial/incorrect code to be refactored rather than blindly copied. fileciteturn341file0

## 7. Build and binding fixes

The existing build/binding correction is treated as **foundation implementation**, not product functionality.

The build contract records the actual fixes around migration import paths, build-time remote binding and Worker-vs-Node runtime detection. It also explicitly distinguishes build GREEN from feature completeness. fileciteturn313file0

Disposition:

```text
Build correctness rules -> DIRECT-REUSE
Temporary debugging assumptions -> REJECT
Cloudflare binding semantics -> CURRENT CONTRACT
Business feature logic -> NOT embedded in build workaround
```

## 8. Legacy API / schema boundary

The old API and schema material is never copied merely because it already exists.

The current rule is:

```text
Feature ID
 -> Current Contract
 -> Current API / DTO
 -> Current data model
 -> Reuse/refactor only where compatible
```

This prevents a legacy endpoint from silently becoming a second canonical API.

## 9. Legacy governance / document numbering

Existing document-governance rules already specify that files are not mass-renamed merely for directory aesthetics because cross-references and historical Git records would break. The repository instead uses canonical-source declarations and alias resolution. fileciteturn329file0

Therefore R10 does **not** perform a mass document rename.

Known historical governance items such as duplicate numbering and the `215`/`216` conflict remain governed by the document-governance contract. Until an explicit authority decision exists, ambiguous documents must not be used as implementation authority. fileciteturn329file0

## 10. 1.0 high-value reuse closure

The original high-value allocation already established that 1.0 business semantics are reused but old database tables, old API paths and obsolete Payload implementation are not copied. fileciteturn318file0

R1-R9 have now closed the major reuse channels:

```text
R1 API / Contract
R2 AuthZ / Security
R3 State Machine
R4 Event / Job / Queue
R5 Advertising
R6 PAY / Commerce / Revenue
R7 IP / Rights / MCN
R8 Data / Migration / Portability
R9 CI / Validator / Evidence
R10 Legacy Final Disposition
```

## 11. Final rejection list

The project must not reintroduce:

- legacy database tables as a parallel schema;
- legacy API paths as canonical APIs;
- obsolete Payload internals;
- temporary workarounds as permanent architecture;
- duplicate identity systems;
- duplicate authorization registries;
- duplicate entitlement stores;
- duplicate wallet/ledger/settlement systems;
- duplicate rights ownership systems;
- duplicate analytics truth;
- queue state as domain truth;
- cache as authorization truth;
- historical audit reports as current implementation evidence;
- manual “GREEN” declarations without executable evidence.

## 12. Post-R10 operating rule

After R10, broad 1.0 reuse audits are closed.

The normal development path is now:

```text
Feature ID
  -> Contract
  -> Reuse / Refactor / Missing Implementation
  -> Unit Tests
  -> Integration Tests
  -> Security / Concurrency Tests
  -> CI
  -> GitHub SHA
  -> Evidence
  -> Verified
```

If a genuinely new capability is discovered, use Change Control and assign a new Feature ID. Do not reopen the entire 1.0 audit cycle.

If an implementation defect is discovered, fix the concrete defect and its evidence. Do not respond with another broad inventory audit.

## 13. R10 closure decision

**CLOSED.**

The 1.0 reuse channel is formally closed at allocation/disposition level.

Historical assets remain available as reference, but they no longer constitute a parallel implementation authority.

**Next phase: functional Contract-First implementation and real CI/evidence verification.**

Important: R10 itself does **not** claim the application runtime is GREEN. Runtime GREEN must be earned by executable tests and GitHub Actions evidence for each implementation batch.
