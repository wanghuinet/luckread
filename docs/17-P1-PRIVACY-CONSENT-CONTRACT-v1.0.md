# P1 Privacy and Consent Contract v1.0

## 1. Purpose

This contract defines platform-wide rules for privacy, consent, data minimization, user data access, account deletion, sensitive data handling, and privacy-aware API behavior.

It applies to account, content, social, analytics, recommendation, notification, moderation, organization, IP, and administrative domains.

## 2. Core Principles

The platform MUST enforce:

- purpose limitation;
- data minimization;
- least privilege;
- explicit and auditable consent where consent is the lawful basis;
- separation of consent from general terms acceptance;
- revocability where applicable;
- access transparency;
- retention limitation;
- privacy by default;
- server-side authorization.

Consent MUST NOT be used as a substitute for authorization.

## 3. Data Classification

Every collected or generated data category MUST have a declared classification and purpose.

At minimum, the design MUST distinguish:

- public content;
- account/profile data;
- private user data;
- organization data;
- behavioral/analytics data;
- security/fraud data;
- rights/audit evidence;
- operational telemetry;
- sensitive data requiring additional controls.

Each category MUST identify its permitted consumers and retention policy.

## 4. Purpose and Collection

A data field MUST have a documented purpose before being introduced into a contract or collection.

APIs and background jobs MUST NOT collect or replicate fields merely because they may be useful later.

Derived datasets MUST document their source fields, purpose, retention, and access scope.

## 5. Consent Model

Where consent is required, a consent record MUST be explicit and machine-readable.

A consent record SHOULD contain:

- consentId;
- principalId;
- purpose;
- policy/version accepted;
- scope;
- grantedAt;
- revokedAt when applicable;
- source/channel;
- evidence/reference.

Consent MUST be versioned so policy changes do not silently reinterpret historical consent.

The platform MUST distinguish:

- required service terms;
- optional communications consent;
- analytics consent where required;
- personalization/recommendation consent where required;
- third-party sharing consent where required.

## 6. Consent Revocation

Where consent is revocable, revocation MUST be effective according to an explicit contract-defined time boundary.

Revocation MUST stop future processing that depends on that consent, subject to lawful retention or other applicable authority.

Revocation MUST NOT silently erase required security/audit evidence.

The platform MUST NOT require unnecessary consent to access functionality that does not depend on the optional purpose.

## 7. Authorization Boundary

Privacy controls and authorization are separate but cumulative.

A request MUST satisfy both:

`authorization permission + privacy/data-purpose policy`

A role such as administrator MUST NOT automatically grant unrestricted access to private user data.

Sensitive data access MUST be scoped, auditable, and justified by an allowed purpose.

## 8. API Data Minimization

APIs MUST return only fields required by the declared response purpose and caller scope.

Internal fields MUST NOT become public API fields merely because they exist in Payload or D1.

Public list endpoints MUST avoid returning unnecessary private identifiers, contact details, security state, internal notes, or authorization metadata.

Field-level filtering MUST occur server-side.

## 9. User Data Access and Export

Where user data access/export is supported, the platform MUST define:

- requester verification;
- authorization boundary;
- included data classes;
- excluded/legally retained data;
- asynchronous generation for large exports;
- expiration of download access;
- audit trail.

Exports MUST NOT expose another principal's private data through shared resources without explicit authorization.

## 10. Account Deletion and Privacy

Account deletion MUST follow the Data Lifecycle Contract.

The platform MUST define per-data-class treatment rather than assuming that deleting the account row deletes all related data.

Authored or owned content MUST follow ownership/rights rules.

Security, financial, legal, and audit records MAY require retention where contractually or legally necessary; such exceptions MUST be explicit and access-controlled.

## 11. Third-Party and Organization Access

Organization or MCN membership MUST NOT automatically authorize access to all personal data of members.

Third-party integrations MUST receive only explicitly permitted scopes.

External sharing MUST identify recipient scope, purpose, and applicable consent/authorization requirements.

Access tokens, credentials, and secrets MUST never be included in ordinary domain events, analytics, exports, or logs.

## 12. Privacy-Preserving Logging

Logs and telemetry MUST minimize personal data.

Request IDs, correlation IDs, resource IDs, and security-relevant classifications SHOULD be preferred over raw payload capture.

Production logging MUST NOT record passwords, authentication secrets, access tokens, payment credentials, or unnecessary private content.

Debug-level sensitive logging MUST be explicitly controlled and time-bounded.

## 13. Analytics and Recommendation Data

Behavioral data used for analytics, ranking, or recommendation MUST have an explicit purpose and access boundary.

Derived profiles MUST NOT be exposed as authoritative user attributes unless the domain contract explicitly defines them.

Data collected for one purpose MUST NOT silently become an unrestricted input to unrelated features.

## 14. Moderation and Safety Access

Moderation and safety personnel MAY require access to restricted content, but such access MUST be:

- role/entitlement controlled;
- scope-limited;
- purpose-bound;
- auditable;
- subject to account and organization policy.

Moderation access MUST NOT silently confer ownership, publication, or distribution rights.

## 15. Data Subject Operations

The platform SHOULD define machine-readable operations for applicable privacy workflows, including:

- access/export;
- correction;
- consent update/revocation;
- deletion request;
- restriction/processing hold where applicable.

Each operation MUST have explicit authorization, state, idempotency, audit, and lifecycle semantics.

## 16. Cross-Store Privacy Consistency

Privacy state MUST propagate consistently across:

- D1 authoritative records;
- R2 objects;
- cache;
- search/index projections;
- event consumers;
- asynchronous jobs;
- analytics/derived stores.

A stale cache, index, or event consumer MUST NOT expose data after a privacy restriction becomes effective.

Cleanup and propagation jobs MUST be idempotent and version-aware.

## 17. Retention and Legal Exceptions

Every privacy-sensitive data class MUST reference a retention policy.

Retention exceptions MUST be explicit, scoped, and auditable.

The platform MUST distinguish:

- active operational retention;
- user-requested deletion;
- legal/security retention;
- anonymization;
- permanent purge.

The system MUST NOT promise physical deletion when an explicit retention exception prevents it.

## 18. Security Incidents

A privacy/security incident MUST NOT be hidden by ordinary data deletion or log rotation.

Relevant security evidence MUST follow the audit and retention contracts.

Incident-response access MUST be separately controlled and auditable.

## 19. Machine-Readable Alignment

Privacy vocabulary MUST remain consistent across JSON Schema, OpenAPI, authorization policy, lifecycle state machines, events, and DTOs.

Canonical concepts SHOULD include:

`purpose`, `consentId`, `consentVersion`, `scope`, `grantedAt`, `revokedAt`, `dataClassification`, `retentionPolicy`, `privacyState`.

Domain contracts MUST reference these concepts instead of inventing incompatible consent or privacy semantics.

## 20. Acceptance Criteria

- [ ] Every collected data category has a declared purpose/classification.
- [ ] Consent is versioned and separate from authorization.
- [ ] Consent revocation semantics are explicit.
- [ ] Administrator/organization roles do not imply unrestricted private-data access.
- [ ] API responses follow data minimization.
- [ ] User export/access semantics are defined.
- [ ] Account deletion follows lifecycle and rights contracts.
- [ ] Third-party and organization access is scope-limited.
- [ ] Logs exclude secrets and unnecessary private data.
- [ ] Analytics/recommendation data has explicit purpose boundaries.
- [ ] Moderation access is auditable and does not grant rights ownership.
- [ ] Privacy state propagates across D1/R2/cache/index/events/jobs.
- [ ] Retention exceptions are explicit.
- [ ] Privacy operations are idempotent and auditable.
- [ ] Contract CI can validate required privacy vocabulary and invariants.
