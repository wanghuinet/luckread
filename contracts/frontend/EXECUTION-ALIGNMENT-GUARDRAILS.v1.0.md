# LuckRead Execution Alignment Guardrails v1.0

**Status: PROPOSED FOR PRODUCT-OWNER REVIEW**  
**Scope: ongoing GitHub execution across LuckRead App, H5, and PC/Web**  
**Purpose: prevent execution drift; this file does not supersede any existing ACTIVE contract.**

## 1. Source of truth
- The repository's currently ACTIVE contracts, approved Change Controls, and their formally maintained trackers remain the authority.
- Do not treat PROPOSED, DRAFT, REVIEW REQUIRED, or NOT-IMPLEMENTATION-AUTHORIZATION documents as active coding authorization.
- If the authoritative tracker does not cover App, H5, and PC/Web as one coordinated scope, record the governance gap and do not invent a parallel roadmap or silently narrow the product objective.
- Resolve conflicts by contract hierarchy and evidence; do not select whichever document is convenient.

## 2. Every `continue` execution
1. Inspect current main SHA, repository state, active contracts, formal tracker, recent commits, open PRs, CI, relevant source and tests.
2. Close out the previous assistant-authored PR first, within the user's merge authorization and safety gates. Do not allow assistant PR backlog to accumulate.
3. Identify the formal current stage and its remaining exit criteria. Do not change the stage or create a replacement roadmap autonomously.
4. Execute one substantial, cohesive task per round; avoid artificial fragmentation.
5. Scope implementation to the stage's complete acceptance objective—not a single component, page, or client unless that is the complete authorized slice.
6. Keep App, mobile H5, and desktop PC/Web on the unified X/Threads-inspired product trajectory, while respecting platform-native behavior and LuckRead branding.
7. Local defect fixes are supporting work and must not substitute for the stage's product objective.
8. Do not repeat work that has already been verified and accepted unless new evidence demonstrates a defect or regression.
9. Do not modify, commit to, merge, close, or retarget another engineer's PR without explicit PR-specific authorization.
10. Do not deploy unless the user explicitly authorizes deployment.
11. Perform substantive source changes, targeted tests and CI-backed PR delivery; planning, audit prose, or adding tests alone is not a substitute for implementation where implementation is feasible and authorized.
12. At stage exit, assess App, H5, PC/Web, shared API/authority, UI, interaction, performance, accessibility and test coverage against the contract. Report unsupported or unverified dimensions honestly.
13. Run a drift check before and after implementation. If drift is detected, stop the unrelated direction and return to the formal stage.
14. Never claim code, tests, CI, device/runtime verification, merge or deployment that has not been observed.
15. Continue within the authorization and contract gates without repeatedly asking the user to re-authorize routine steps.

## 3. Drift check
Before implementation, answer internally and record in PR:
- Does this directly advance the formally current stage?
- Is this already implemented or covered by an open PR?
- Is this complete-stage scope or merely a local polish task?
- Are API authority, access, contracts and tests understood?
- Will this move the unified three-client product forward?

After implementation, verify the PR remains aligned with the stage and that no unrelated scope was added.

## 4. Stop / block conditions
- Contract or stage authority is ambiguous, or the relevant document is only PROPOSED/DRAFT: do not falsely treat it as active; present the evidence and use the smallest governance-resolution PR or decision required.
- Missing API, domain authority, permissions, change control, or CI evidence: block only the affected scope and report exact evidence.
- Conflict with another engineer's work: preserve their PR untouched and work only in a separate authorized scope.
- No deployment or live-device validation is claimed unless actually performed.

## 5. Reporting
Each round should concisely report: formal stage and source; drift assessment; substantial changes; PR and CI status; verified facts; remaining blockers and unverified items; whether stage exit criteria are met.

This guardrail is governance guidance pending review. It cannot retroactively authorize work prohibited by an ACTIVE contract, nor elevate a proposed experience contract or tracker to ACTIVE.
