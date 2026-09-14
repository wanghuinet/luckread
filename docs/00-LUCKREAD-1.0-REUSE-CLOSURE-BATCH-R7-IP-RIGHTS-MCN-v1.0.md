# LuckRead 1.0 Reuse Closure — Batch R7 IP / Rights / MCN v1.0

> Status: **CLOSED / REUSE ALLOCATED / RIGHTS FOUNDATION LOCKED**

## 1. Objective

Consolidate existing 1.0 IP, rights, licensing, attribution, MCN and creator-organization assets into the canonical 2.0 domain model. This batch creates no second identity, creator, organization, rights, wallet, ledger or settlement authority.

Implementation rule:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Tests/CI -> GitHub SHA -> Evidence`

## 2. Existing canonical assets

The repository already contains the high-value reuse allocation and the dedicated IP/Rights/MCN/Incubation enhancement contract. The established model separates identity, roles, ownership, attribution, rights and financial settlement instead of collapsing them into one creator/IP record.

Relevant canonical assets include:

- `docs/00-LUCKREAD-1.0-HIGH-VALUE-REUSE-ALLOCATION-CLOSURE-v1.0.md`
- `docs/00-LUCKREAD-BLUEPRINT-ENHANCEMENT-BATCH-06-IP-RIGHTS-MCN-INCUBATION-v1.0.md`
- `docs/64-*` rights/IP contract assets
- `docs/214-IP-LICENSE-COMMERCIAL-SETTLEMENT-ROYALTY-COMMISSION-TAX-CONTRACT-v1.0.md`
- creator / organization / authorization contracts already admitted by the blueprint.

The IP licensing contract already connects commercial licensing, royalty, commission and settlement semantics to the financial authority rather than creating a parallel financial system.

## 3. Canonical model

```text
Identity
  -> Creator / Organization
  -> IP Principal
  -> Members / Roles
  -> Ownership / Rights
  -> Attribution
  -> Licensing
  -> Transaction
  -> Entitlement / Revenue Split
  -> Ledger
  -> Settlement
  -> Audit
```

The same financial authority established by R6 remains authoritative for transactions, revenue split, ledger and settlement.

## 4. Reuse disposition

| 1.0 asset / capability | 2.0 canonical owner | Disposition | Rule |
|---|---|---|---|
| Creator identity | CREATOR / USER | ALREADY-ABSORBED | Creator is not duplicated by IP |
| Organization / MCN | ORG | ALREADY-ABSORBED | MCN is an organization capability |
| IP principal | RIGHTS / CREATOR | DIRECT-REUSE | Preserve `principal` semantic; never create `ip_founder` |
| IP member roles | AUTHZ / CREATOR / RIGHTS | DIRECT-REUSE | Roles do not themselves grant platform-wide permissions |
| IP ownership | RIGHTS | DIRECT-REUSE | Ownership remains distinct from membership |
| RightsHolder | RIGHTS | DIRECT-REUSE | Rights semantic, not organization-member role |
| Licensor | RIGHTS | DIRECT-REUSE | Licensing authority stays in Rights |
| Attribution | CONTENT / RIGHTS | MERGE | Attribution is separate from ownership |
| IP verification | RIGHTS / GOV | DIRECT-REUSE | Verification state is explicit and auditable |
| Rights transfer | RIGHTS | DIRECT-REUSE | Transfer requires authorization, validation and audit |
| IP dissolution | RIGHTS / CREATOR | MERGE | Dependencies and retained rights must be resolved before closure |
| Licensing | RIGHTS | DIRECT-REUSE | Contractual rights and scope remain explicit |
| Royalty / commission | RIGHTS + PAY | MERGE | Rights determines contractual allocation; PAY is financial authority |
| MCN revenue split | ORG + PAY | MERGE | Declarative split resolves before settlement |
| Creator earnings | PAY | ALREADY-ABSORBED | No creator-specific ledger |
| Settlement | PAY | ALREADY-ABSORBED | No IP/MCN settlement authority |
| IP marketplace | MARKETPLACE | ALREADY-ABSORBED | Marketplace is orchestration, not rights authority |
| Brand/creator matching | MARKETPLACE | ALREADY-ABSORBED | Matching does not grant rights |
| Incubation | IPINCUBATION | DIRECT-REUSE | Uses canonical Creator/Rights/PAY/Analytics authorities |
| IP audit | RIGHTS / GOV / AUDIT | MERGE | Full provenance required |

## 5. IP role boundary

Canonical IP roles are:

```text
principal
creator
editor
producer
operator
```

These roles describe participation in an IP. They are not a substitute for the platform authorization model.

The forbidden duplicate identity is:

```text
ip_founder
```

`principal` is the canonical IP-principal semantic.

## 6. Ownership / Attribution boundary

Ownership and attribution must remain independent:

```text
Ownership -> who controls / owns the applicable right
Attribution -> who receives creator/credit recognition
```

A creator can receive attribution without owning the IP. A rights holder can hold rights without being the creative contributor. Attribution must never silently grant ownership, licensing rights or payment rights beyond the applicable contract.

## 7. Rights lifecycle

The canonical IP lifecycle is:

```text
DRAFT
 -> PENDING_VERIFICATION
 -> VERIFIED
 -> ACTIVE
 -> TRANSFERRING
 -> ACTIVE (new principal)
```

Exceptional paths include `SUSPENDED` and `DISSOLVED`.

Transfer must preserve historical ownership, effective dates, evidence and audit. Dissolution cannot simply cascade-delete dependent content, licenses, transactions or historical rights evidence.

## 8. Licensing / financial boundary

Licensing creates contractual rights and commercial obligations. It does not directly mutate financial balances.

```text
License / Commercial Event
 -> Financial Evidence
 -> PAY Transaction
 -> Revenue Split
 -> Ledger
 -> Settlement
```

Royalty, commission, creator share, MCN share, platform share and other participants must be represented as a versioned declarative split that remains traceable to its originating transaction.

Refunds, chargebacks and disputes follow PAY's immutable-fact correction model.

## 9. MCN boundary

MCN is an organization capability, not a second creator identity.

MCN may provide:

- creator membership;
- contracts;
- revenue split rules;
- management workflows;
- analytics views;
- settlement views;
- operational roles.

MCN must not create:

- a second wallet authority;
- a second ledger;
- a second creator identity;
- a parallel entitlement store;
- an independent platform authorization engine.

Organization scope and resource scope remain explicit. Cross-organization access defaults to DENY.

## 10. Incubation reuse

IP Incubation remains a product/workflow layer above the canonical domains.

Lifecycle:

```text
DRAFT
 -> OPEN
 -> SCREENING
 -> SELECTED
 -> IN_PROGRESS
 -> SUBMITTED
 -> REVIEWING
 -> REVISION_REQUIRED / REJECTED
 -> ACCEPTED
 -> PUBLISHED
 -> MEASURED
 -> SETTLED
 -> CLOSED
```

Incubation rewards use the canonical PAY authority. Analytics measures outcomes but cannot create financial truth. Rights governs ownership/licensing questions; Creator/Org governs participants and scopes.

## 11. Explicit rejection

The 2.0 platform rejects:

- `ip_founder` as a new identity/role authority;
- IP-specific duplicate creator accounts;
- IP-specific duplicate organization authorization;
- attribution being treated as ownership;
- membership role being treated as automatic platform permission;
- rights ownership being inferred from creator attribution alone;
- marketplace matching granting rights;
- licensing directly mutating wallet/ledger;
- MCN-owned parallel financial truth;
- cascade deletion of historical rights/financial evidence;
- hidden cross-organization access;
- external contract/provider state becoming canonical rights truth.

## 12. Implementation readiness boundary

This batch closes only reuse allocation. It does **not** claim runtime implementation or CI GREEN.

Required implementation chain remains:

`Feature ID -> Contract -> Reuse/Refactor -> Missing Implementation -> Unit/Integration/Security/Concurrency Tests -> CI -> GitHub SHA -> Evidence`

## 13. R7 closure decision

**CLOSED at reuse/allocation level.**

No new IP/Rights/MCN architecture is authorized from 1.0. Existing canonical contracts are the reuse base.

Next batch: **R8 — Data / Migration / Portability reuse closure.**
