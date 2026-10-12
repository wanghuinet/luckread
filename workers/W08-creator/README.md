# W08 — Authorization / Creator / Organization

Canonical Worker identity: **W08**
Canonical responsibility: **Authorization / Creator / Organization**
Primary Tasks: **T03, T04**
Primary D1 authority: **D1-01**

Canonical repository path: `workers/W08-creator`.

Boundary:
- Creator and organization capabilities belong to W08 under the approved Task/Contract model.
- Search is not the canonical logical role of W08.
- No unrestricted cross-D1 writes.
- No new business ownership is inferred from unrelated directory naming.


## Shared CASL authorization

- Policy source: `src/authz/casl-policy.ts`; L0-L8 policy tests live beside it.
- Internal `POST /internal/authz/check-permission` resolves actor identity from the W02 session over `W02_AUTH`, derives current account/role/scope facts from D1-01, and rejects request-body `subjectId`, layer, or account state.
- Creator application creation, own-status reads, and review endpoints use the same CASL policy. Workflow controls such as self-review prevention, optimistic concurrency, idempotency, and retriable W02 grants remain separate mandatory checks.
- W02 remains the sole writer of `role_assignments`. W08 owns Creator application/identity facts and calls W02 for the L3 grant after approval.
- Keep the existing provisioned Worker name `luckread-w08-creator`, D1-01, and W01 `W08_CREATOR` binding. No new Worker, D1, Queue, or Service Binding is introduced.
