# CC-L8-GENESIS-BOOTSTRAP-OUT-OF-BAND-APPROVAL-2026-10-24

- Status: PROPOSED IN PR #1299 / NOT MERGED / NOT DEPLOYED / NO PRODUCTION MUTATION
- Scope: one-time initial creation of the first effective global `super_admin` (L8) RoleAssignment.
- Related: `docs/301-L0-L8-PERMISSION-LAYER-CONTRACT-v1.0.md`, `docs/307-SECURITY-THREAT-MODEL-CONTRACT-v1.0.md`, `contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md`, `.github/workflows/admin-account-bootstrap.yml`.
- Architecture invariant: W02 remains the sole writer of RoleAssignment on D1-01. W01 remains the public request boundary and may call W02 only through the existing `W02_AUTH` Service Binding. No direct D1 writes from GitHub Actions; no new Worker, D1, Queue, or Service Binding.

## 1. Single-maintainer genesis decision

The repository currently has one authorized maintainer. For the first L8 bootstrap only, replace the two-person PR-review requirement with **one required GitHub Environment approval** by the sole repository admin/maintainer. This is an explicit, narrowly scoped reduction in the normal L8 approval control; it is not the policy for routine L8 grants or privileged operations.

The source code fails closed unless the GitHub Environment `l8-genesis-bootstrap` is configured with all of the following:

- exactly one required reviewer, the repository owner's GitHub account (numeric user ID `190754094`) with repository `admin` or `maintain` permission;
- `prevent_self_review: false`, so the sole maintainer can approve the run they dispatch;
- deployment branch policy restricted to protected branches;
- workflow execution from protected `main`, using the fixed workflow path and signed GitHub OIDC token.

GitHub's environment gate must approve the workflow job before its steps can run. W02 then queries the environment configuration and rejects a missing reviewer rule, multiple reviewers, a team reviewer, an underprivileged reviewer, or an unprotected branch policy. The request PR number is included in the workflow run name so the operator can inspect the target-bound request before approving. A source-file `approved=true` flag is never accepted.

## 2. Immutable request

The merged request PR must contain exactly one file: `docs/change-control/l8-genesis-bootstrap-request.json`. That request binds:

- the exact Better Auth `targetUserId`;
- operation `INITIAL_L8_BOOTSTRAP`;
- role `super_admin`, global scope and no scope ID;
- a reason/change-control reference;
- a cryptographically random single-use nonce;
- creation and expiry timestamps, with a maximum request lifetime of four hours.

The request PR must be merged to `main`; W02 reads the JSON at the immutable merge commit SHA. Unrelated code changes, expired requests, changed targets, malformed IDs, a changed role/scope, or replayed nonces fail closed.

## 3. One approval, one run

- The operator manually dispatches `.github/workflows/l8-genesis-bootstrap.yml` from protected `main` and supplies the merged request PR number. The workflow checks out the immutable `github.sha` for that run, not the moving `main` branch, so its static gate and execution script cannot silently drift while waiting for approval.
- The GitHub Environment requires one approval. That one approval gates the whole run.
- Before any write, the run executes `scripts/verify-admin-account-bootstrap-readiness.mjs`. This source/evidence gate must pass; it currently must remain blocked while AUTH-007 is `BLOCKED_NOT_GREEN`.
- If the gate passes, the same run obtains a short-lived OIDC token, calls W01's public API, and performs a read-only production preflight. A failed preflight never calls the grant route.
- Only after the preflight passes does the same run request the one-time write. W02 independently revalidates the token, environment configuration, request, account state, L2 role, current L8 state, one-time guard and expiry. W02 alone writes the RoleAssignment.
- The four-hour grant is bounded by the canonical L8 contract. It is not a permanent L8 assignment.

No direct D1 mutation, credential write, ad hoc SQL, additional Worker, or secret-bearing workflow is allowed.

## 4. MFA and production admission stay fail-closed

L8 is not usable until W02's role resolver verifies Better Auth's TOTP enrollment state. The bootstrap path must never accept request-body MFA booleans or caller-supplied assurance claims. However, the repository's AUTH-007 reconciliation still records that canonical MFA operation/DTO contracts and complete executable evidence are missing. Therefore the new workflow runs the readiness gate first, and **no production initialization is permitted while AUTH-007 remains `BLOCKED_NOT_GREEN`**. The presence of MFA-related tables or a layer-level resolver is not a substitute for a green contract-and-test evidence chain.

## 5. Permanent audit guard and four-hour scope

The path is available only when no effective global L8 exists. The singleton `l8_genesis_bootstrap_audit` row and nonce hash permanently consume the genesis path after success; there is no reset API. The role assignment is time-limited to at most four hours, then expires/downgrades under the canonical L8 contract. Subsequent privileged grants must follow the standard process; the one-time genesis exception is not reusable.

## 6. Cleanup after successful initialization

Do **not** delete bootstrap code before the first L8 has actually been granted and verified; doing so would make initialization impossible. Immediately after a successful run and independent read-back, MFA enrollment/verification and audit confirmation, create a cleanup PR that removes these temporary bootstrap entry points:

- `.github/workflows/l8-genesis-bootstrap.yml`;
- `scripts/execute-l8-genesis-bootstrap.mjs`;
- W01 routes `workers/W01-payload/src/app/api/v1/admin/bootstrap/super-admin/route.ts` and `workers/W01-payload/src/app/api/v1/admin/bootstrap/super-admin/readiness/route.ts`;
- W02 bootstrap verifier/command/readiness modules and their route wiring in `workers/W02-identity/src/index.ts`;
- bootstrap-only tests, request file and any obsolete bootstrap workflow/checker after checking all references.

Preserve `workers/W02-identity/migrations/0007_l8_genesis_bootstrap_audit.sql`, the permanent audit table/row, the normal W02 RoleAssignment writer, canonical MFA enforcement, standard privileged-approval logic and negative tests. Never remove evidence, audit records, MFA controls or the protections against self-escalation. Deploy the cleanup to W01/W02 after merging the cleanup PR, then scan all routes/workflows for remaining references.

## 7. Current status

This change-control record does not authorize production writes. PR #1299 remains unmerged and undeployed; migrations and Worker deployments have not run. AUTH-007 remains `BLOCKED_NOT_GREEN`, so the new static readiness gate must fail and the workflow must not reach production mutation until the MFA contract and evidence are complete. The single-approval code is a narrowly scoped bootstrap exception, not evidence that L8 has been initialized.
