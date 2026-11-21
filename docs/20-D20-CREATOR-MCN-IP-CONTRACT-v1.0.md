# D20 Creator / Professional Creator / MCN / IP Contract v1.0

## 0. Contract Status

- Domain: D20 Creator / Professional Creator / MCN / IP Management
- Status: CONTRACT-FROZEN
- Source of truth: this contract
- Implementation rule: Contract → Machine-readable schema/API → CI → implementation
- D1-Fabric is explicitly outside this project boundary.

## 1. Core Invariants

1. Creator Level ≠ Role ≠ Creator Profile ≠ Organization ≠ IP Ownership ≠ Entitlement.
2. MCN is an Organization relationship, not a User field.
3. A creator has a current MCN only when an MCN Representation/Contract is `ACTIVE`.
4. If no `ACTIVE` MCN representation exists, the public creator profile MUST NOT expose an MCN field or an “unaffiliated MCN” placeholder.
5. `DRAFT`, `PENDING`, `EXPIRED`, `TERMINATED`, `REVOKED`, and `DISPUTED` MCN contracts MUST NOT produce a current public MCN relationship.
6. IP Founder is scoped to an IP and is NOT platform administration.
7. Creator, Author, Owner, Publisher, Licensee, Founder and Contributor are distinct relationships.
8. Creator statistics are derived from Analytics; they are not authoritative mutable counters in the Creator record.
9. Revenue allocation is defined by Creator/IP contracts; payment, settlement and payout execution remain in the Monetization domain.
10. All public affiliation data MUST pass privacy, organization policy, authorization and relationship-state checks.

## 2. 40-Point Capability Contract

### 020-01 Creator Identity

`creator_id`, `user_id`, `tenant_id`, `organization_id`, `creator_type`, `status`, timestamps.

### 020-02 Creator Types

`CREATOR`, `PROFESSIONAL_CREATOR`, `ORGANIZATION_CREATOR`; future specialized creator types are additive and versioned.

### 020-03 Creator State

`CREATED`, `ACTIVE`, `RESTRICTED`, `SUSPENDED`, `CLOSED`, `DELETED`.

### 020-04 Creator API

- `POST /creators`
- `GET /creators/{creator_id}`
- `PATCH /creators/{creator_id}`
- `GET /me/creator`
- `POST /me/creator/activate`
- `POST /me/creator/close`

### 020-05 Creator Verification

States: `UNVERIFIED`, `PENDING`, `VERIFIED`, `REVOKED`.

Verification MUST NOT grant administrative permission by itself.

### 020-06 Creator Level

Creator level is an identity/capability classification. It MUST NOT replace Role, Permission, Entitlement or Authorization.

### 020-07 Creator Profile

Public/private profile fields include display name, avatar, biography, category, locale, links and controlled organization affiliation.

### 020-08 Creator Category

Category is a discovery/business classification and MUST be versioned where used for ranking or policy.

### 020-09 Creator Statistics

Followers, views, engagement, content counts and revenue summaries are derived from Analytics/Interaction/Commercial domains and MUST be reconcilable.

### 020-10 Creator Content Ownership

Content relationships MUST distinguish `AUTHOR`, `CREATOR`, `OWNER`, `PUBLISHER`, and `LICENSEE`.

### 020-11 Creator Organization Membership

MCN/team/enterprise membership uses the Organization domain. Organization membership alone does not automatically mean MCN representation.

### 020-12 MCN Identity

MCN is an Organization with `organization_type = MCN` and its own organization identity, state, profile, policy and membership.

### 020-13 MCN Creator Contract

MCN representation contract fields MUST include creator, MCN organization, status, effective time, expiry, scope, contract version, visibility policy and audit metadata.

Contract states:

`DRAFT → PENDING → ACTIVE → EXPIRED/TERMINATED/REVOKED/DISPUTED`

Only `ACTIVE` produces a current MCN relationship.

### 020-14 Creator Representation

Representation types: `SELF`, `MCN`, `AGENT`, `STUDIO`, `ORGANIZATION`.

A representation record MUST reference its authoritative organization/subject and contract where applicable.

### 020-15 Creator Team

Team roles may include `CREATOR`, `EDITOR`, `ASSISTANT`, `MANAGER`, `ANALYST`, `MODERATOR`; permissions are scoped through Authorization.

### 020-16 Creator Workspace

Workspace is an aggregation surface over Creator, Content, Media, Analytics, Monetization and Organization APIs. It MUST NOT create duplicate domain facts.

### 020-17 Creator Dashboard API

`GET /creators/{creator_id}/dashboard` returns authorized aggregates and links to authoritative domain resources.

### 020-18 IP Identity

`ip_id`, owner subject, tenant/org, name, description, type, status, timestamps.

### 020-19 IP Types

`PERSONAL_BRAND`, `CHARACTER`, `STORY`, `NOVEL`, `COMIC`, `GAME`, `VIDEO`, `SHOW`, `MUSIC`, `FRANCHISE`; future types are additive.

### 020-20 IP State

`DRAFT`, `ACTIVE`, `RESTRICTED`, `DISPUTED`, `SUSPENDED`, `ARCHIVED`, `CLOSED`.

### 020-21 IP Founder

`FOUNDER` is a scoped IP relationship. It MUST NOT imply global administrator rights, organization ownership, platform privileges or payment authority.

### 020-22 IP Role

Supported roles: `FOUNDER`, `OWNER`, `CO_OWNER`, `IP_MANAGER`, `EDITOR`, `LICENSING_MANAGER`, `FINANCE_MANAGER`, `CONTRIBUTOR`, `VIEWER`.

### 020-23 IP Ownership

Ownership records MUST contain subject, ownership type, percentage/share, effective time, expiry, state and evidence reference where required.

### 020-24 Ownership Invariant

Creator ≠ Owner; Founder ≠ Owner necessarily; Author ≠ Owner; Publisher ≠ Owner; Licensee ≠ Owner.

Ownership changes require authorization, audit and conflict handling.

### 020-25 IP Work Relation

IP may link to Content, Media, Novel, Comic, Game, Live and Mini-App through explicit typed relations. The IP domain MUST NOT duplicate those resources.

### 020-26 IP Contributor

Contributor records identify scoped contribution and permissions. Contributor status MUST NOT imply ownership unless an explicit ownership record exists.

### 020-27 IP License

License fields include licensor, licensee, IP, scope, territory, media/use type, effective time, expiry, state and audit metadata.

### 020-28 License Scope

License scope MUST be explicit for territory, medium/channel, work/use type and time. No implicit unlimited license.

### 020-29 License State

`DRAFT`, `PENDING`, `ACTIVE`, `EXPIRED`, `REVOKED`, `TERMINATED`, `DISPUTED`.

Only `ACTIVE` licenses can satisfy current rights checks.

### 020-30 IP Revenue

IP revenue attribution is a derived commercial view. Money movement belongs to the Monetization domain.

### 020-31 Revenue Allocation

Allocation participants may include `CREATOR`, `IP_OWNER`, `FOUNDER`, `ORGANIZATION`, `CONTRIBUTOR`, `PLATFORM`. Allocation rules MUST be versioned, effective-dated and auditable.

### 020-32 Creator Payout

Creator payout is a downstream Monetization operation. D20 supplies authorized beneficiary/allocation facts; it MUST NOT directly mutate payment balances.

### 020-33 IP Dispute

States: `OPEN`, `UNDER_REVIEW`, `EVIDENCE_REQUIRED`, `RESOLVED`, `REJECTED`, `ESCALATED`.

Disputed ownership/license relationships MUST trigger policy checks before publication or commercial use where applicable.

### 020-34 IP Evidence

Evidence may reference immutable/versioned objects in the Media/R2 boundary with D1 metadata, checksum, timestamp and authorization metadata.

### 020-35 Creator / IP API

Minimum API surface:

- `GET /creators/{id}`
- `GET /creators/{id}/representation`
- `GET /creators/{id}/organizations`
- `GET /creators/{id}/content`
- `GET /ips/{id}`
- `GET /ips/{id}/owners`
- `GET /ips/{id}/roles`
- `GET /ips/{id}/works`
- `GET /ips/{id}/licenses`

### 020-36 IP Management API

Minimum management surface:

- `POST /ips`
- `PATCH /ips/{id}`
- `POST /ips/{id}/members`
- `PATCH /ips/{id}/members/{member_id}`
- `POST /ips/{id}/licenses`
- `PATCH /ips/{id}/licenses/{license_id}`
- `POST /ips/{id}/disputes`
- `GET /ips/{id}/evidence`

All mutations require scoped authorization and idempotency where the operation can be retried.

### 020-37 Events

Minimum events:

- `creator.created`
- `creator.updated`
- `creator.verified`
- `creator.suspended`
- `creator.closed`
- `creator.representation.created`
- `creator.representation.activated`
- `creator.representation.expired`
- `creator.representation.terminated`
- `mcn.contract.created`
- `mcn.contract.activated`
- `mcn.contract.expired`
- `mcn.contract.terminated`
- `ip.created`
- `ip.updated`
- `ip.owner.changed`
- `ip.role.changed`
- `ip.license.activated`
- `ip.license.expired`
- `ip.dispute.created`
- `ip.dispute.resolved`
- `ip.revenue_allocation.changed`

Events MUST be versioned and idempotently consumable.

### 020-38 Security / Performance / Execution Probe

Mandatory negative tests:

1. Creator cannot modify another creator.
2. Creator cannot fabricate an MCN affiliation.
3. Non-MCN organization cannot appear as an MCN representation.
4. `PENDING` MCN contract does not appear on public profile.
5. `EXPIRED` MCN contract does not appear as current MCN.
6. `TERMINATED` MCN contract does not appear as current MCN.
7. IP Founder cannot administer another IP.
8. IP Manager cannot modify ownership unless explicitly authorized.
9. Contributor cannot modify licensing without permission.
10. MCN editor cannot access billing without billing permission.
11. Cross-organization access is denied.
12. Suspended creator cannot publish where policy forbids it.
13. Expired license cannot authorize publication/use.
14. Disputed ownership cannot silently satisfy a rights check.
15. Internal/local API cannot bypass authorization.

Execution Probe MUST verify the actual API routes, state transitions, authorization decisions and event emission in the deployed test environment.

### 020-39 SLO / Cost / Consistency

Measure rather than invent runtime thresholds before evidence exists.

Required observability:

- API latency P50/P95/P99
- authorization latency
- contract state transition failures
- representation consistency failures
- ownership/license conflicts
- event lag
- event duplicate/drop rate
- reconciliation failures
- cache hit/miss where applicable
- storage and query cost

Consistency requirements:

- ACTIVE representation must match an active valid contract.
- Public MCN affiliation must never outlive the effective contract state.
- Ownership/license/revenue allocation versions must be traceable.
- Derived statistics must be reconcilable.

### 020-40 Evidence

D20 is GREEN only when all of the following are evidenced:

- machine-readable schema exists
- API contract validates
- API error/pagination/cursor contract validates
- permission/RBAC tests pass
- state-machine tests pass
- tenant isolation tests pass
- negative authorization tests pass
- MCN ACTIVE-only public-profile rule passes
- expired/terminated/pending MCN visibility tests pass
- IP ownership/license tests pass
- event contract tests pass
- idempotency/concurrency tests pass
- execution probe passes against the actual runtime
- CI workflow is green
- evidence artifacts identify commit SHA, workflow run, test results and contract version

Unknown, missing or unverified evidence MUST remain `BLOCKED` or `INCOMPLETE`; it MUST NOT be reported as GREEN.

## 3. Public Creator Profile MCN Contract

### 3.1 Signed / Active relationship

If and only if there is an `ACTIVE` MCN representation whose contract is currently effective and visible under policy, the public profile MAY expose:

```json
{
  "representation": {
    "type": "MCN",
    "organization": {
      "id": "org_xxx",
      "name": "Example MCN"
    },
    "status": "ACTIVE"
  }
}
```

### 3.2 No active contract

When no effective `ACTIVE` MCN representation exists, the public profile MUST omit the MCN representation field entirely.

It MUST NOT return:

```json
{"mcn": null}
```

or:

```json
{"mcn": "未签约"}
```

or any stale/historical MCN as the current affiliation.

### 3.3 Historical contracts

Historical MCN relationships are not current affiliation. If exposed in a future contract, they MUST use an explicitly historical field and a separate privacy/visibility policy.

## 4. Domain Boundaries

- D01 Auth/Identity owns user identity and account state.
- D02 Authorization owns authorization decisions.
- D03 Organization owns organization and membership facts.
- D04 Content owns content lifecycle.
- D05 Media owns media objects and processing.
- D13 Moderation/Risk owns moderation and risk decisions.
- D14 Analytics owns derived analytics/statistics.
- D15 Monetization owns orders, payments, settlement and payout execution.
- D20 owns creator representation, creator/IP relationships, rights metadata and revenue-allocation rules.
- D20 MUST NOT duplicate facts owned by the above domains.

## 5. Implementation Gate

No production implementation of D20 is considered complete until the contract, API, permission, state machine, event, migration/data model, CI and execution evidence all agree.

The public-profile MCN rule is a mandatory invariant and must be covered by unit, integration, authorization and end-to-end tests.
