# LUCKREAD Blueprint Enhancement — Batch 06

## Status
CLOSED / CONTRACT-FIRST READY

## Scope
Unify IP principal, ownership, rights, attribution, licensing, MCN/organization participation, IP incubation and IP trading without creating parallel authorities.

## Feature IDs
- IP-001 IP profile and lifecycle
- IP-002 Principal management
- IP-003 IP member roles
- IP-004 IP ownership
- IP-005 Rights holder and licensor
- IP-006 Attribution
- IP-007 IP verification
- IP-008 IP transfer
- IP-009 IP dissolution and dependency handling
- IP-010 Rights grant and restriction
- IP-011 License management
- IP-012 IP transaction
- IP-013 IP marketplace listing
- IP-014 IP marketplace discovery and due diligence
- IP-015 IP marketplace offer / negotiation
- IP-016 IP marketplace completion
- MCN-001 MCN organization profile
- MCN-002 MCN membership
- MCN-003 Creator onboarding and management
- MCN-004 Revenue split configuration
- MCN-005 MCN settlement reporting
- IPINCUBATION-001 Incubation center
- IPINCUBATION-002 Incubation plan
- IPINCUBATION-003 Task creation
- IPINCUBATION-004 Task templates
- IPINCUBATION-005 Public creator recruitment
- IPINCUBATION-006 Targeted creator invitation
- IPINCUBATION-007 Creator application
- IPINCUBATION-008 Screening
- IPINCUBATION-009 Selection
- IPINCUBATION-010 Task execution
- IPINCUBATION-011 Content submission
- IPINCUBATION-012 Review and revision
- IPINCUBATION-013 Acceptance
- IPINCUBATION-014 Performance data
- IPINCUBATION-015 Reward settlement
- IPINCUBATION-016 Creator rating
- IPINCUBATION-017 Creator growth
- IPINCUBATION-018 Incubation leaderboard
- IPINCUBATION-019 Case studies
- IPINCUBATION-020 Risk and anti-fraud

## Canonical IP model
`IP -> Principal -> Members/Roles -> Ownership/Rights -> Attribution -> Licensing -> Transaction -> Entitlement/Revenue -> Settlement -> Audit`

`principal` is the canonical IP principal semantic. Do not introduce an `ip_founder` role. RightsHolder and Licensor are rights semantics, not organization-member roles. Attribution remains separate from membership roles.

## IP lifecycle
`DRAFT -> PENDING_VERIFICATION -> VERIFIED -> ACTIVE -> TRANSFERRING -> ACTIVE(new principal)`
with `SUSPENDED` and `DISSOLVED` terminal/exception paths according to dependency and rights policy.

Transfer or dissolution must not blindly cascade-delete content, media, licenses, transactions or audit records. Dependencies require explicit resolution, retention and ownership/routing policy.

## MCN model
MCN is an organization capability, not a second creator identity system. Organization membership, scoped roles, creator relationship and revenue split reuse AUTHZ/ORG/CREATOR/PAY contracts.

Cross-organization access is deny-by-default. Organization roles do not automatically grant platform-wide permissions.

## IP Incubation Center
The Incubation Center sits between IP ownership/rights and the creator ecosystem:

`IP -> Incubation Plan -> Task -> Creator Pool -> Application/Invitation -> Production -> Review -> Publication -> Performance -> Reward -> Long-term Collaboration / Market`

Task types may include article, image-text, short video, long video, live, interaction/comment, IP promotion, hashtag challenge, series content, co-creation, character/world creation and derivative creation for compliant novel/drama/game properties.

## Incubation task lifecycle
`DRAFT -> OPEN -> SCREENING -> SELECTED -> IN_PROGRESS -> SUBMITTED -> REVIEWING -> REVISION_REQUIRED/REJECTED -> ACCEPTED -> PUBLISHED -> MEASURED -> SETTLED -> CLOSED`

Targeted invitations and public recruitment share the same task authority. Application, selection and creator rating must remain auditable.

## Reward modes
Supported reward policies include fixed task fee, performance-based reward, conversion/sales-based reward, IP revenue share and long-term collaboration. All monetary results use the Batch 05 financial authority; incubation must not create its own wallet or ledger.

## Marketplace relationship
Incubation and Trading are complementary:
- Incubation creates and grows IP/content/creator relationships.
- Trading handles rights/licensing/transaction opportunities.
- Rights remains the authority for ownership and license semantics.
- PAY remains the authority for money.
- CREATOR remains the authority for creator identity/profile.

## Security and governance invariants
1. IP principal, ownership and rights are scoped and auditable.
2. Attribution does not imply ownership or permission.
3. Creator participation does not automatically grant IP rights.
4. Cross-org access defaults to DENY.
5. Rights grants must have explicit scope, duration and allowed use where applicable.
6. Incubation content cannot bypass moderation, copyright or entitlement rules.
7. Performance data used for reward calculation must use defined anti-fraud/quality policy.
8. Reward settlement is traceable to task, acceptance, performance policy, transaction, ledger and settlement.
9. IP transfer/dissolution preserves dependencies and audit history.
10. Marketplace and incubation cannot become alternate authorities for creator, rights or payment state.

## 1.0 reuse
Reuse mature 1.0 semantics for Principal, IP member roles, ownership, attribution, RightsHolder/Licensor, verification, transfer/dissolution, licensing, transaction, revenue split, settlement, MCN organization/member semantics and audit. Do not copy obsolete schema/API/Payload implementation.

## Acceptance
Batch 06 is closed when all IP/MCN/incubation/marketplace implementation items map to these Feature IDs and the contracts reference the existing AUTHZ, CREATOR, ORG, RIGHTS, PAY, CONTENT, ANALYTICS, GOV and AUDIT authorities.

## Next
Batch 07 — Advertising / Brand / Creator Marketplace.
