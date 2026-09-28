# CC-MAPPING-0-PRIV-004-RETENTION-POLICY-AUTHORITY-DECISION-PACKET-2026-09-27

## Status

`CONTRACT_SHAPE_ADMITTED / PRODUCTION_ENGINEERING_POLICY_INSTANCE_ADMITTED / AUTHORITY_CLOSED`

## Purpose

将 PRIV-004 从“无具体权威结构”推进到最小、可审计的 Policy Config Authority 合同，同时不虚构任何具体法律保留期限。

## Authoritative basis

- `docs/175-FEATURE-FLAG-CONFIG-POLICY-VERSIONING-CONTRACT-v1.0.md`
- `docs/160-DATA-LIFECYCLE-RETENTION-ERASURE-CONTRACT-v1.0.md`
- `docs/184-L5-L6-IDENTITY-AND-SESSION-INSTANCE-REGISTRY-v1.0.md`
- `contracts/entity/PRIV-002-consent-field-contract.v1.json`
- `contracts/persistence/PRIV-002-consent-persistence-contract.v1.json`

## Admitted minimum authority

`contracts/privacy/PRIV-004-retention-policy-authority.v1.json` now freezes:

- policy-config class and versioned authority semantics;
- owner/scope/environment requirements;
- approval lifecycle;
- `LEGAL_AUDIT` binding for the current consent use case;
- effective period;
- deterministic rule shape: duration or fixed-until;
- immutable policyVersion capture in consent;
- fail-closed behavior when no applicable approved policy instance exists;
- historical interpretability by policyVersion;
- approval, effective-period, evaluation and provenance evidence requirements.

## Intentionally not admitted

- jurisdiction-specific legal conclusion or statutory retention mandate;
- runtime code or migration;
- Mapping 0 GREEN or Evidence Registry promotion.

## AUTH-001 impact

AUTH-001 now has an explicitly admitted production engineering policy instance for deterministic `ENT-CONSENT.retentionUntil` calculation. Runtime implementation/evidence remains governed by its own existing admission and evidence gates.

The previous gap is therefore closed from:

`policy authority contract admitted / first approved policy instance pending`

to:

`production engineering policy authority admitted / versioned instance active`

## Closed gate

`PRIV-004::first approved ACCOUNT_REGISTRATION / LEGAL_AUDIT production engineering policy instance admitted with version, scope, effective period, deterministic rule, approval and provenance evidence.`

The admitted production policy is explicitly an internal engineering authority and does not assert a jurisdiction-specific legal conclusion. A later formal legal/compliance schedule can replace it by normal policy versioning without changing the runtime architecture.

## Non-authorizations

- no new Worker;
- no new D1;
- no new Queue;
- no Payload Core change;
- no client-selected retention;
- no Mapping 0 GREEN;
- no AUTH-001 runtime evidence admission.
