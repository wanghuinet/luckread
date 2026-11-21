# Mapping 0 Historical Verification Persistence Audit — 2026-09-19

Repository: `wanghuinet/luckread`
Authority: GitHub `main`
Purpose: distinguish historical verification work that is persisted in GitHub from conversational checks that are not independently persisted, and identify stale persisted records that can cause unnecessary re-verification.

## 1. Audit boundary

This audit uses the Mapping 0 history retained in the available conversation context plus the current GitHub `main` history and artifacts.

It does **not** claim to reconstruct every sentence ever exchanged across every prior conversation. Therefore:

- `PERSISTED` means a GitHub file, commit, workflow run, or artifact can be identified.
- `PERSISTED_STALE` means the verification was persisted but its recorded baseline/freshness no longer matches the current review state.
- `CHAT_ONLY_OR_NOT_PROVEN` means the activity is present in conversation history but no dedicated GitHub verification record has been identified from the accessible history.
- `REVALIDATION_REQUIRED` means the historical evidence exists but its validity conditions have expired or the tested subject changed.

No conversational recollection is promoted to evidence merely because it sounds consistent with current state.

## 2. Formal Mapping 0 verification work with GitHub persistence

| Verification area | Historical result | GitHub persistence | Current disposition |
|---|---|---|---|
| Feature Inventory ↔ Canonical Mapping cardinality | 449 ↔ 449; missing/orphan = 0 | Structural Gate workflow + current Mapping-0 snapshot | PERSISTED / reusable for unchanged head |
| Mapping 0 structural gate | GREEN at recorded baseline | workflow run/job recorded in `docs/MAPPING-0-VERIFICATION-SNAPSHOT-2026-09-19.md` | PERSISTED_STALE relative to later documentation/correction commits; rerun only for a current-head certificate |
| Evidence-reference coverage | 449/449 references reported; 0 broken refs | acceptance docs + gate history | PERSISTED; reference integrity is distinct from executable evidence |
| Entity Catalog / Entity-Field schema gate | READY/PASS at recorded baseline | structural verification snapshot | PERSISTED_STALE by baseline age, but no known semantic change requiring broad re-test |
| Batch G orphan governance | 58/58 dispositioned; pending = 0 | disposition register, artifact, workflow run | PERSISTED / CLOSED unless scope changes |
| Canonical scope protection | AI/ANALYTICS/GROWTH kept outside canonical 449 | acceptance records + disposition history | PERSISTED / CLOSED for current scope |
| AUTH-001 W01 path alignment | evidence path corrected to W01 | commit history + mapping docs | PERSISTED |
| USER code/evidence path alignment | W01 authority recorded | commit history + alignment docs | PERSISTED |
| Batch B-F canonical evidence-reference reconciliation | dedicated reconciliation docs attached; status remained fail-closed | commits for Batch B/C/D/E/F | PERSISTED; no technical promotion |
| AUTH authority reconciliation | AUTH-001..016 audited with no unsupported promotion | reconciliation docs + mapping commits | PERSISTED; residual blockers remain |
| AUTH-002 local schema evidence | local Miniflare D1 schema check PASS | Evidence Registry B05 + artifact | PERSISTED_STALE / REVALIDATION_REQUIRED |
| AUTH-002 local migration evidence | local migration PASS | Evidence Registry B06 + artifact | PERSISTED_STALE / REVALIDATION_REQUIRED |
| AUTH-002 local session runtime | core lifecycle checks PASS, with explicit gaps | Evidence Registry B07 + runtime manifest | PERSISTED_STALE / REVALIDATION_REQUIRED |
| AUTH-002 runtime gap analysis | second logout 400; concurrent two valid sessions; extension correlation gap | runtime manifest + current snapshot | PERSISTED / OPEN |
| AUTH-003..010 W01 runtime audit | no feature-specific runtime implementations; blocked | Evidence Registry B08 records + reconciliation docs | PERSISTED_STALE / OPEN |
| Entity/Persistence semantic correction | AUTH-relevant entities changed from NOT_APPLICABLE to NOT_VERIFIED | Change Control + inventory commits | PERSISTED |
| AUTH-002 persistence mode correction | LUCKREAD_EXTENSION → MIXED | Change Control + registry commit | PERSISTED |
| AUTHZ/ORG authority coverage | existing authority catalog found; feature-level bindings still unverified | artifact + Change Control | PERSISTED |
| AUTH-006 status classification ambiguity | explicit API/entity refs exist, but deterministic MISSING/PARTIAL rule is absent | Change Control + current mapping | PERSISTED / OPEN |
| Contract CI diagnostic | failure observed without exposed job-level cause | acceptance snapshot + prior run references | PERSISTED; root cause still unknown |

## 3. Conversational checks that are not independently proven as persisted

The following activities are visible in the retained conversation history, but there is no dedicated per-event GitHub verification record identified:

| Conversation activity | Classification | Why it matters |
|---|---|---|
| Repeated requests such as “现在多少 / 有没有增加 / 现在呢” | CHAT_ONLY_OR_NOT_PROVEN | Progress discussion, not a durable verification event |
| Repeated “继续推进 / 继续批量推进” turns | CHAT_ONLY_OR_NOT_PROVEN | Execution intent; not itself evidence |
| Re-checking whether Mapping 0 was ready for development | CHAT_ONLY_OR_NOT_PROVEN | Decision discussion; final acceptance boundary is persisted separately |
| Asking whether previous validations needed re-validation after context growth | CHAT_ONLY_OR_NOT_PROVEN | Meta-verification discussion; no historical verification ledger existed before this audit |
| Repeated concern about GPT forgetting prior validation | CHAT_ONLY_OR_NOT_PROVEN | Governance concern; not itself a test |
| Discussion of local W01 working-tree state | CHAT_ONLY_OR_NOT_PROVEN | User-supplied operational context, not a Mapping 0 evidence record |
| Discussion of whether Payload/D1 fields might conflict | CHAT_ONLY_OR_NOT_PROVEN | Design/review question; no feature/runtime proof created by the discussion alone |

These items should **not** be counted as failed or successful technical validations. They are conversation events unless accompanied by a GitHub evidence record.

## 4. Where unnecessary repeated verification can occur

A material source of repetition is not complete loss of GitHub records; it is **record discoverability and freshness ambiguity**.

Observed examples:

1. The repository has multiple Mapping-0 snapshot documents whose baseline heads differ.
2. The current `MAPPING-0-VERIFICATION-SNAPSHOT-2026-09-19-CURRENT.md` still contains an older AUTH-002 persistence-mode value (`LUCKREAD_EXTENSION`) even though the current registry is `MIXED`.
3. `artifacts/mapping-0/mapping-0-status-report.json` was generated at an older commit and still reports persistence-registry record count = 0, while the current registry contains one AUTH-002 record.
4. Evidence Registry records are correctly retained but now marked EXPIRED; a future conversation can mistakenly interpret historical PASS as current PASS unless the freshness boundary is read first.

These are **persistence/freshness problems**, not proof that the original validation never happened.

## 5. High-confidence conclusion about “validated but not saved”

From the currently recoverable Mapping 0 history:

- There are many formal validation activities with explicit GitHub persistence.
- There is **no reliable evidence that the major Mapping 0 gate/reconciliation batches were performed only in chat and then completely lost**.
- There **are** conversational checks whose results were not given a durable verification-event ID, so they cannot be safely reused as evidence in a new conversation.
- The bigger current risk is **stale or ambiguously scoped persisted verification**, which can cause either needless re-validation or incorrect reuse of historical results.

Therefore the safe classification is:

**Formal Mapping 0 validations: mostly persisted.  
Ad-hoc conversational re-checks: not proven persisted.  
Current persisted records: several are stale and need explicit freshness handling.**

## 6. Required anti-duplication rule

For future Mapping 0 work, a verification must have:

`verificationId + testedCommit + scope + result + evidenceRef + validity`

A new conversation must first look up that tuple.

Reuse rule:

- same scope + same tested subject + evidence valid → **REUSE**
- same scope + subject changed → **TARGETED REVALIDATION**
- evidence expired → **REVALIDATION REQUIRED**
- historical chat claim without GitHub evidence → **NOT EVIDENCE / DO NOT RE-RUN blindly; register the gap first**
- unknown prior verification → **AUDIT HISTORY BEFORE EXECUTION**

## 7. Current audit disposition

This audit itself is documentation/governance only. It does not promote any Mapping 0 status, does not create technical mappings, does not execute migrations, and does not constitute runtime evidence.

Next corrective action is to remove the identified current-document/artifact freshness drift and then use this audit as the durable lookup point before any future Mapping 0 verification.
