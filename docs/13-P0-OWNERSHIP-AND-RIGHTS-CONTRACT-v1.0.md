# P0 Ownership and Rights Contract v1.0

## 1. Purpose

This contract defines the canonical ownership, authorship, control, publishing, licensing, distribution, and attribution model for Luckread.

It is a P0 contract. No API, collection, workflow, IP Center feature, MCN feature, or content operation may define an independent rights model that conflicts with this document.

Payload remains the CMS/core implementation layer. This contract defines platform semantics and authorization boundaries; it does not reimplement Payload internals.

## 2. Core Invariant

The platform MUST NOT treat authorship, ownership, control, publication authority, distribution authority, or attribution as the same concept.

A principal MAY hold one or more rights relationships over the same resource. Each relationship MUST be explicit, auditable, scope-limited where applicable, and independently revocable unless a higher-order legal/business rule requires otherwise.

## 3. Canonical Actors

### 3.1 Author

The person or principal who created the substantive work or contribution.

Author status describes contribution/authorship. It does not by itself grant ownership, publication authority, commercial control, or distribution rights.

### 3.2 Creator

The platform-level creator identity responsible for operating a creator account or creator presence.

Creator status MAY include multiple authored resources and MAY coexist with ownership held by another principal or organization.

### 3.3 Owner

The principal or organization holding the platform-recognized ownership interest for a resource.

Ownership MUST be represented explicitly and MUST NOT be inferred solely from uploader, author, creator, administrator, or current publisher status.

### 3.4 Controller

The principal authorized to make governance decisions for a resource within a defined scope.

Control MAY be delegated without transferring ownership.

### 3.5 IP Founder

The principal recognized as the founding/controlling rights origin for an IP entity in the IP Center.

IP Founder is an IP relationship, not a synonym for every author, creator, owner, or administrator associated with works under the IP.

### 3.6 IP Manager

A principal delegated operational management authority over an IP entity or defined IP scope.

IP Manager authority MUST be bounded by explicit scope and MUST NOT imply ownership transfer.

### 3.7 Publisher

A principal authorized to publish or unpublish a resource within an explicit publication scope.

Publisher authority MUST NOT imply ownership unless separately granted.

### 3.8 Licensee

A principal receiving specified rights from an owner/controller or other legally authorized grantor.

A license MUST define scope and validity. Licensee status does not imply ownership.

### 3.9 Distributor

A principal authorized to distribute a resource through one or more specified channels, territories, or media.

Distribution authority MUST be independently represented from publication authority.

## 4. Rights Dimensions

Every protected resource MUST conceptually distinguish at least:

- authorship/contribution;
- ownership;
- control/governance;
- display attribution;
- publication authority;
- distribution authority;
- licensing authority;
- derivative/adaptation authority;
- translation/localization authority;
- moderation authority;
- administrative access.

A permission on one dimension MUST NOT silently imply another dimension.

## 5. Explicit Grant Model

Rights grants MUST be explicit objects or equivalent machine-readable records with, at minimum:

- grantId;
- resourceId or resource scope;
- grantor principal;
- grantee principal;
- right/action;
- scope;
- startAt;
- endAt when temporary;
- status;
- organization context when applicable;
- conditions/restrictions when applicable;
- createdAt/updatedAt;
- audit reference.

The authorization layer MUST evaluate active grants rather than trusting client-provided role labels.

## 6. Scope Model

A rights grant MAY be scoped by:

- resource;
- IP entity;
- content collection;
- organization;
- creator account;
- media type;
- publication channel;
- territory;
- locale;
- time window;
- derivative/adaptation type.

The effective right MUST be the intersection of the principal's authorization and the grant scope.

## 7. License Contract

Licenses MUST support explicit vocabulary for:

- display/use;
- publication;
- distribution;
- commercial use;
- derivative/adaptation;
- translation/remix;
- media/channel;
- territory;
- start/end validity.

An expired, revoked, or otherwise invalid license MUST NOT authorize the operation.

The platform MUST preserve license history for audit and dispute handling.

## 8. Delegation and Revocation

Delegation MUST:

1. identify the grantor and grantee;
2. identify the exact right and scope;
3. record validity;
4. enforce the grantor's authority to delegate;
5. be auditable.

Revocation MUST invalidate future authorization according to the contract's effective-time rules and MUST NOT silently rewrite historical audit records.

## 9. Transfer and Inheritance

Ownership or control transfer MUST be represented as an explicit state-changing operation.

Transfers MUST preserve:

- previous holder;
- new holder;
- effective time;
- authority/evidence reference;
- affected resource/IP scope;
- audit trail.

Existing grants MUST have a defined transfer policy. They MUST NOT be silently assumed to survive or disappear.

Inheritance MUST use the same explicit transfer semantics and MUST NOT be inferred from account deletion alone.

## 10. Organization and MCN Model

Organization membership and MCN membership MUST be separate from resource ownership.

A user may be:

- an organization member without owning its resources;
- an owner whose operational management is delegated to an organization;
- an IP Founder represented by an organization;
- an IP Manager without ownership;
- an Author/Creator whose work is published or distributed by an organization.

Organization-scoped authority MUST include organization identity/version and MUST be checked together with resource rights.

## 11. IP Center Boundary

The IP Center MUST be the canonical domain for IP-level identity and rights relationships.

An IP entity SHOULD support explicit relationships to:

- IP Founder;
- IP Manager;
- creators;
- authors;
- owners/right holders;
- publishers;
- licensees;
- distributors;
- derivative works;
- related content/media.

IP Center APIs MUST expose these relationships through stable resource identifiers and contract-defined authorization. UI-only relationships are forbidden.

## 12. Authorization Boundary

For a protected resource operation, effective authorization MUST be evaluated using at least:

`principal + action + resource + scope + ownership/control/rights + organization + account state + policy version`

Examples:

- `content.publish` requires publication authority, not merely authorship.
- `content.transfer` requires ownership/control authority sufficient to transfer.
- `ip.manage` requires IP management authority within the requested IP scope.
- `content.distribute` requires distribution authority for the requested channel/territory.
- `content.adapt` requires derivative/adaptation rights.
- `content.translate` requires translation/localization rights when the source license requires them.

All denials MUST fail closed.

## 13. API Requirements

APIs exposing rights-bearing resources MUST:

- return stable resource IDs;
- avoid exposing hidden authorization assumptions as client-trusted fields;
- return contract-defined authorization errors;
- enforce organization/resource scope server-side;
- support pagination/cursors for relationship collections where applicable;
- emit request/correlation identifiers;
- produce audit events for rights mutations.

Bulk rights operations MUST apply the same authorization rules to every target resource and MUST define partial-failure semantics before implementation.

## 14. Conflict Resolution

Conflicting rights MUST NOT be resolved by UI order, request order, or last-write-wins assumptions.

The platform MUST define precedence using explicit rules, including at minimum:

1. account-state restrictions;
2. explicit resource rights;
3. organization scope;
4. active license/delegation scope;
5. policy constraints;
6. time validity.

Where a conflict cannot be resolved deterministically, the operation MUST fail closed and enter a reviewable state rather than guessing.

## 15. Audit and Evidence

Rights creation, modification, delegation, revocation, transfer, publication-authority changes, and ownership changes MUST be auditable.

Audit records MUST identify actor, target, action, effective scope, result, request/correlation ID, timestamp, and relevant policy/version information.

Historical attribution and rights evidence MUST remain queryable according to retention policy even after the active relationship changes.

## 16. Machine-Readable Alignment

The following vocabulary MUST remain aligned across JSON Schema, OpenAPI, authorization policy, state machines, and implementation DTOs:

`author`, `creator`, `owner`, `controller`, `ip_founder`, `ip_manager`, `publisher`, `licensee`, `distributor`

Rights/actions SHOULD use stable dotted permission identifiers such as:

- `content.read`
- `content.edit`
- `content.publish`
- `content.distribute`
- `content.adapt`
- `content.translate`
- `content.transfer`
- `ip.read`
- `ip.manage`
- `ip.transfer`
- `rights.grant`
- `rights.revoke`

The vocabulary MUST NOT be duplicated with conflicting definitions in individual domain documents.

## 17. Security Invariants

The implementation MUST enforce:

- no ownership inference from uploader identity;
- no ownership inference from administrator status;
- no publication authority inference from authorship;
- no IP Founder inference from creator status;
- no licensee authority outside license scope;
- no organization authority outside organization scope;
- no rights use after expiration/revocation;
- no authorization cache acceptance across invalidated policy/role/organization/resource-rights versions;
- fail-closed behavior on missing or contradictory rights evidence.

## 18. Acceptance Criteria

This contract is implementation-ready only when all are true:

- [ ] Actor vocabulary is machine-readable.
- [ ] Ownership, authorship, control, publication, distribution, and licensing are separate dimensions.
- [ ] Explicit grants and scopes are representable.
- [ ] Delegation and revocation semantics are defined.
- [ ] Transfer/inheritance semantics are defined.
- [ ] Organization/MCN relationships are scope-safe.
- [ ] IP Founder and IP Manager are distinct from Creator and Author.
- [ ] IP Center is an API-visible domain, not UI-only metadata.
- [ ] Resource authorization consumes rights state and versions.
- [ ] Conflicts fail closed rather than guessing.
- [ ] Rights mutations are auditable.
- [ ] OpenAPI/JSON Schema vocabulary can reference this contract without semantic duplication.
- [ ] Contract CI validates required rights vocabulary and invariants before implementation admission.
