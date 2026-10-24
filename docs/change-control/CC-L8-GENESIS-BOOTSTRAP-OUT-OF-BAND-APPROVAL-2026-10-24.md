# CC-L8-GENESIS-BOOTSTRAP-OUT-OF-BAND-APPROVAL-2026-10-24

- Status: IMPLEMENTED IN PR #1299 / NOT MERGED / NOT DEPLOYED / NO PRODUCTION MUTATION
- Scope: one-time initial creation of the first effective global `super_admin` (L8) RoleAssignment.
- Related: `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md`, `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`, `contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md`, `.github/workflows/admin-account-bootstrap.yml`.
- Architecture invariant: W02 remains the sole writer of RoleAssignment on D1-01. W01 remains the public request boundary and may call W02 only through the already-existing `W02_AUTH` Service Binding. No direct D1 writes from GitHub Actions; no new Worker, D1, Queue, or Service Binding.

## 1. Problem being resolved

The application currently has no L8 principal. Requiring existing application L8 identities to approve the first L8 grant creates a circular bootstrap dependency. That dependency must not be solved by silently skipping the two-person control.

## 2. Genesis-only approval authority (out-of-band dual approval)

For the first L8 only, dual approval is supplied out-of-band by two distinct, authorized GitHub repository maintainers. These are approval identities, not LuckRead application roles; no existing L8 account is required.

The approval must be bound to an immutable bootstrap request that records at least:

- the exact Better Auth `targetUserId`;
- operation `INITIAL_L8_BOOTSTRAP`;
- the reason and ticket/change-control reference;
- a cryptographically random single-use nonce;
- request creation time and short expiry;
- the intended role `super_admin`, global scope, and maximum four-hour grant.

The executing workflow must verify the request PR is merged into `main`, that two distinct eligible human reviewers approved the exact latest PR head, neither reviewer is the request author, and the approved request file binds the same target, operation, nonce, expiry, and role. Both approvals must be fetched from GitHub's review API at execution time; user-supplied reviewer names or an unverified JSON list are not evidence. No code path may accept a self-asserted `approved=true` field.

## 3. Execution and authority boundary

- Workflow authentication and immutable approval evidence are validated by W02 before any mutation.
- `.github/workflows/l8-genesis-bootstrap.yml` has separate `preflight` and `execute` modes; `preflight` performs a read-only production check and never calls the grant route. `execute` repeats the same preflight immediately before mutation and requires a separate explicit dispatch.
- The workflow must call the W01 public API boundary. W01 validates the external approval evidence and forwards the admitted command to W02 through the existing `W02_AUTH` binding.
- W02 revalidates all target, one-time, role-mapping, expiry, and approval constraints, then alone creates the global `super_admin` RoleAssignment.
- Use a deterministic idempotency key derived from the approved request/nonce; concurrent retries must not create a second effective assignment.
- Emit durable audit provenance that includes the request PR, exact approved commit, two reviewer identities, target user ID, role/scope, reason, nonce hash, and result. Never log credentials, session tokens, or bootstrap secrets.
- Immediately invalidate the authoritative role-version/cache state using the existing W02 mechanism.
- The workflow must read back the result via the authoritative W02 path and verify the exact target, global role, validity interval, and audit reference.

## 4. MFA is not waived by genesis mode

Genesis approval solves only the missing in-app approver identity. It does not waive MFA or step-up requirements. The grant must not become usable for privileged operations until the target account has completed the contract-approved MFA enrollment and verification. The current AUTH-007 record is `BLOCKED_NOT_GREEN`; therefore no active, usable L8 grant is admitted until MFA runtime enforcement and negative tests are implemented and reviewed.

The bootstrap path must deny all privileged operations before MFA is verified, permit only the minimum account-security/MFA-enrollment actions needed to complete setup, and ensure an unverified L8 assignment cannot be used to bypass that gate.

## 5. One-time and expiry conditions

- The path is available only when no effective global `super_admin` assignment exists.
- The nonce/request can be consumed exactly once; replay, expired request, changed target, changed role/scope, duplicate approver, self-approval, stale review, or missing audit commit all fail closed.
- Maximum initial role validity is four hours, matching the canonical L8 contract. The role is not a permanent bootstrap credential.
- A second L8 or subsequent L8 role assignment does not use this genesis exception and must follow the standard reviewed privileged-approval workflow.

## 6. Review and production admission gates

Before enabling production mutation, a separate review must confirm:

- a W02-only bootstrap grant command and internal route;
- W01 endpoint and exact existing `W02_AUTH` forwarding;
- real GitHub PR-review validation on the latest approved commit;
- target-bound, two-distinct-reviewer checks and replay resistance;
- MFA/step-up enforcement before privileged use;
- audit persistence, role-version/cache invalidation, and read-back verification;
- executable positive and negative tests for every condition above;
- successful controlled runtime evidence bound to the deployed source commit.

This change-control record does not authorize production writes. Runtime source and negative tests have been added in PR #1299, but the PR is unmerged, current GitHub Actions checks have not completed, D1 migrations and Worker deployments have not run, and no online read-only preflight evidence has been produced. AUTH-007 remains `BLOCKED_NOT_GREEN`; do not run execute mode until the merge, independent review, CI/build, controlled migration and deployment evidence, online preflight, and MFA contract/evidence gate are all satisfied.