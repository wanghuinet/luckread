# LuckRead 1.0 Development Execution Standard v1.0

**Status:** ACTIVE  
**Scope:** Engineering execution standard for LuckRead 1.0  
**Authority:** Execution Standard only; does not replace or override existing Blueprint, Contract, L5, L6, Evidence Registry, Change Control, CI, or Admission rules.

## 1. Purpose

This document defines the smallest common execution method for one engineer + one GPT to develop LuckRead 1.0 with stable context, low management overhead, controlled change scope, and evidence-backed completion.

The authoritative chain remains:

**Blueprint → Contract → L1/L2/L3/L4 → L5 Execution Specification → Vertical Slice → L6 Verification/Evidence → CI/Admission → GREEN**

This document governs **how existing authority is executed**. It does not create a second product authority.

## 2. Authority and Non-Substitution

The following remain authoritative in their existing locations:

- Product scope and intent: existing Blueprint and approved product documents.
- Rules and interfaces: existing Contracts.
- Execution detail: L5.
- Atomic verification and evidence: L6 and the existing Evidence Registry.
- Scope changes: existing GAP / Change Control / Reconciliation process.
- CI, admission, and release decisions: existing project gates.

This document must not be used to invent, duplicate, rename, or silently replace an existing authority.

No new business field, operationId, entity owner, permission rule, state transition, API schema, or architecture boundary may be introduced by this document.

## 3. Development Structure

LuckRead development is organized as:

**Stage → Vertical Slice → Implementation → Verification → Evidence → Admission → GREEN**

### Stage

A Stage groups a coherent product/domain area and normally contains **3–5 Vertical Slices**.

Stages are planned progressively. Only the current Stage is refined in detail; future Stages remain directionally planned.

### Vertical Slice

A Vertical Slice is one complete engineering value loop across the necessary layers.

A Slice should normally have:

- one clear user/domain outcome;
- one primary domain boundary;
- independent testability;
- independent evidence;
- a clear rollback/commit boundary;
- a bounded implementation footprint.

Practical guardrails for a single engineer + GPT are normally:

- 2–8 directly relevant Contracts;
- 1–5 core Entities;
- 1–3 Workers where applicable;
- roughly 3–15 changed code/config/test files;
- roughly 500–2500 lines of meaningful change.

These are **control limits, not mandatory quotas**. A Slice may be smaller when a contract is risky or larger when the domain is naturally cohesive. Split only when context, review, evidence, or rollback becomes unsafe.

Worker boundaries are deployment boundaries, not task boundaries.

## 4. Standard Slice Execution Loop

Every Slice follows the same sequence:

### Step 1 — Scope
Read the latest `main`, identify the current Stage/Slice, and state the single intended outcome.

### Step 2 — Contract Check
Read only the Contracts/L5/L6/Evidence directly relevant to the Slice.

Confirm:

- authority is clear;
- inputs/outputs are defined;
- authorization/scope is defined where applicable;
- state/concurrency/idempotency rules are defined where applicable;
- persistence and side effects are defined;
- test/evidence expectations are defined.

If authority is missing or contradictory, **STOP** and use GAP → Change Control → Reconciliation. Do not solve the ambiguity in code.

### Step 3 — Implementation
Implement the smallest production change that satisfies the admitted authority.

Prefer existing project patterns, native platform behavior, and existing utilities over speculative abstractions.

Do not create future-facing architecture merely because it may be useful later.

### Step 4 — Verification
Run the relevant tests/checks required by the applicable L5/L6.

At minimum, cover the applicable happy path and failure path; also cover authorization, state conflict, retry/idempotency, side effects, recovery, security, or performance where the contract requires them.

### Step 5 — Evidence
Record actual evidence tied to the implementation commit.

Evidence must be reproducible and sufficiently fresh for the claim. Old or unrelated evidence must not be reused as proof for a changed implementation.

### Step 6 — Admission
Run the applicable CI/admission checks.

Only after the required evidence and gates pass may the Slice be marked **GREEN**.

Allowed truthful outcomes are:

- **GREEN**
- **BLOCKED**
- **NOT RUN**

No unverified work may be described as complete.

## 5. Context Control: One Conversation = One Slice

To prevent long-context drift:

**One development conversation handles one Vertical Slice.**

When the current Slice reaches GREEN:

1. stop development in the current conversation;
2. report the Slice result, commit SHA, evidence status, and next Slice;
3. begin the next Slice in a new conversation.

The next conversation must restore state from GitHub, not from assumptions about the previous chat.

This is a mandatory operating rule for the GPT workflow.

## 6. @Superpowers Resume Protocol

When a new conversation starts with:

**`@Superpowers 继续`**

the assistant must reconstruct state from the latest authoritative repository state.

The recovery order is:

1. latest `main` SHA;
2. current Stage;
3. current Slice;
4. already-GREEN Slices;
5. blocking/open items;
6. directly relevant Contract/L5/L6/Evidence;
7. latest implementation and tests.

Already-PASS/GREEN work is reused rather than re-executed unless a current change invalidates its evidence.

The assistant must identify **one current work surface** and work only on that surface.

It must not restart Mapping 0, re-audit unrelated domains, or repeat completed work merely because a new conversation was opened.

## 7. Scope and Change Control

Normal implementation may change code, tests, implementation configuration, and evidence artifacts required by the admitted Contract.

The following require the existing governance path and may not be decided unilaterally:

- new product capability;
- new authoritative rule;
- Contract conflict;
- duplicate operationId;
- entity ownership conflict;
- new cross-domain transactional dependency;
- API authority not already admitted;
- change to an existing state machine or permission model;
- architecture expansion that is not already governed.

Use:

**GAP → Change Control → update Blueprint/Contract → Reconciliation → GREEN → implementation**

Do not encode an unresolved decision as an implementation shortcut.

## 8. Rolling Planning

Do not create a detailed task list for the entire 1.0 release up front.

The stable structure is:

- Stage definitions;
- Slice sizing rules;
- Slice execution loop;
- admission/gate rules.

Detailed Slice plans are created only when the relevant Stage becomes active.

This keeps the plan current with the actual repository state and minimizes planning overhead for a one-engineer project.

## 9. Daily Engineering Rhythm

For a daily budget of several hours, the default rhythm is:

- **15–30 min:** restore state and select the current Slice;
- **1–2 h:** implementation of the Slice;
- **30–60 min:** tests, review, evidence, and gate checks;
- **10–20 min:** commit and status closure.

The objective is not maximum code volume. The objective is a repeatable sequence of **one mature, verifiable Slice at a time**.

## 10. Stage Gate

A Stage is complete only when all of its Slices have:

- implementation committed;
- applicable tests passed;
- required evidence recorded;
- Contract/L5/L6 reconciliation completed;
- required CI/admission checks passed;
- no unresolved blocking dependency within the Stage.

Then the Stage may be marked **GREEN** and the next Stage may begin.

## 11. LuckRead 1.0 Release Gate

LuckRead 1.0 is not defined by the number of Workers completed.

Release requires the governed product scope plus:

- implemented approved capabilities;
- Contract/L5/L6 traceability;
- required runtime evidence;
- security/privacy checks;
- performance and cost validation where applicable;
- reliability/recovery validation where applicable;
- observability and operational readiness;
- production admission and release approval.

Only the existing project authorities may make the final release decision.

## 12. Current Execution Pointer

At adoption of this standard, execution follows this order:

**Stage 0 — Mapping 0 / Engineering Governance**
→ **W01/W02 current-state acceptance**
→ **Stage 1 — Identity / Account**
→ **Slice 1 — Session Lifecycle Closure**

The current repository state and existing evidence determine whether an item is already GREEN, needs evidence only, is BLOCKED, or still requires implementation.

No completed Mapping 0 or W01/W02 evidence is discarded or needlessly repeated.

## 13. Guardrails

Always:

- read latest `main` first;
- reuse valid evidence;
- keep authority singular;
- implement minimally;
- verify before claiming completion;
- commit at the Slice boundary;
- stop when blocked;
- start the next Slice in a new conversation after GREEN.

Never:

- mark planned work as completed;
- call uncommitted local work GREEN;
- create a parallel Contract system;
- silently redefine an existing Contract;
- broaden a Slice into unrelated product work;
- restart completed work solely because the conversation changed.

## 14. Document Boundary

This standard is an **engineering execution document**, not a product or API Contract.

It does not define:

- business fields;
- API schemas;
- operationIds;
- permissions;
- state machines;
- persistence authority;
- entity ownership;
- new Workers;
- new D1 topology;
- new product capabilities.

All such decisions remain under the existing LuckRead governance system.

---

**Operational rule:** One engineer + one GPT, one Slice per conversation, latest `main` as truth, evidence before GREEN, and GREEN before the next Slice.
