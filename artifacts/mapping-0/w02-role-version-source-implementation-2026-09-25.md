# W02 Role Version Source Implementation — 2026-09-25

- Repository authority: GitHub `main`
- Implementation commit scope: RoleAssignment authorization-version mechanism only
- Contract semantics changed: **NO**
- W01 / Wire DTO / public API semantics changed: **NO**
- New Worker / new D1 domain: **NO**

## Implemented source facts

1. D1-01 now has a generated `role_authorization_versions` table owned by the existing W02/T03 authorization boundary.
2. `role_version` is persisted per authoritative `subject_id`.
3. Missing row is interpreted as logical version `0`; first mutation creates version `1`.
4. Subsequent mutations use an atomic SQLite/D1 upsert and increment exactly once per helper invocation.
5. Read and mutation helpers reject an empty subject id and fail on malformed persisted version data.
6. The mechanism is internal security metadata; it does not add a public field, User.layer, or a new authorization entity.

## Verification boundary

This change proves source-level existence and unit behavior only.

Still open and intentionally not marked GREEN:
- remote D1 migration execution evidence;
- W02 deployment/source/version evidence;
- integration of every authoritative RoleAssignment mutation path with `advanceRoleVersion`;
- controlled role revocation/cache invalidation runtime evidence;
- authLogin/authRefresh end-to-end evidence.

The existing Mapping 0 / R4 downstream blockers are inherited and are not altered by this slice.
