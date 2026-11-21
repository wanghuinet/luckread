# Mapping 0 — RoleAssignment Real Evidence Absence Audit — 2026-09-21

- Audit ID: M0-AUTHZ-ROLE-ASSIGNMENT-REAL-EVIDENCE-AUDIT-001
- Domain: D1-01 Identity / Account / Access
- Entity: ENT-ROLE-ASSIGNMENT
- Status: PASS_VERIFIED_AUDIT — NO CURRENT IMPLEMENTATION/PERSISTENCE/RUNTIME EVIDENCE FOUND

## Scope

This audit checks whether current repository evidence already proves a concrete authoritative RoleAssignment source. It does not create or modify the RoleAssignment schema.

## Current catalog / persistence evidence

The current Entity Catalog records:

- entityId: ENT-ROLE-ASSIGNMENT
- domainId: D1-01
- classification: AUTHORIZATION
- status: PROPOSED

The current entity-field contract records ENT-ROLE-ASSIGNMENT as PROPOSED with no registered implementation fields.

The current database-entity persistence inventory records ENT-ROLE-ASSIGNMENT as PROPOSED with an empty implementationRef.

The current entity implementation-evidence registry records:

- implementationStatus: CONTRACT_ONLY
- implementationRefs: []
- schemaEvidenceRefs: []
- migrationEvidenceRefs: []
- payloadNativeEvidenceRefs: []
- extensionEvidenceRefs: []
- blockers: No concrete implementation evidence recorded.
- status: BLOCKED

The current code-evidence inventory also records ENT-ROLE-ASSIGNMENT as CONTRACT_ONLY with no implementation/test references.

## Repository source / migration search

Searches for physical RoleAssignment representations returned no current repository implementation matching:

- role assignment SQL table creation;
- role-assignment migration;
- role_assignment / role_assignments physical table;
- concrete RoleAssignment runtime service/handler;
- role assignment persistence implementation.

The only current concrete RoleAssignment references are contracts, authority decisions, mapping audits and evidence-gap controls.

## Remote D1 evidence boundary

Existing remote D1 evidence recorded by AUTH-002 is limited to the application/session baseline and the `auth_session_state` extension state, plus native Payload tables such as `users` and `users_sessions`.

No current retained evidence proves a RoleAssignment physical table or live RoleAssignment records.

Therefore the remote D1 evidence cannot be promoted as a RoleAssignment source.

## Authority decision

The following are explicitly rejected as RoleAssignment authority:

- Payload User.role compatibility metadata;
- native Payload users/users_sessions state;
- auth_session_state;
- contracts/authz/layers.json role vocabulary itself;
- cache state or role_version alone;
- documentation-only entity definitions;
- historical W00/W08 bindings.

The only canonical authority remains:

`D1-01 RoleAssignment`

but that authority is currently **contracted, not implemented/evidence-bound**.

## E6 consequence

GAP-E6-RUNTIME-001 cannot be closed by connecting the resolver to an existing proven table because no such RoleAssignment implementation evidence currently exists.

The remaining implementation prerequisite is now evidence-defined:

1. establish the physical/runtime realization of the already-contracted D1-01 RoleAssignment authority under approved Change Control;
2. register its entity/field/persistence/implementation evidence;
3. establish the canonical W02/T01/T03 implementation boundary;
4. bind the existing deterministic resolver;
5. produce controlled authLogin/authRefresh E6 runtime evidence.

No new D1, Worker, authority model, User.layer or duplicate RoleAssignment source is implied by this audit.

## Anti-loop freeze

This absence finding is now recorded as a closure fact. Future work must not repeat broad RoleAssignment searches unless a new implementation/persistence commit or remote evidence artifact changes the evidence set.
