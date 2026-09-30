# AUTH-012 authLogin Risk Surface Reconciliation v1.0

Status: CONTRACTED_PARTIAL / NOT GREEN
Implementation authorization: false

## Canonical source reconciliation

`AUTH-012` is the suspicious-login detection feature. The feature inventory and capability mapping bind it to `authLogin`, but they do not establish runtime implementation evidence.

The current Auth API policy defines `authLogin` as `POST /auth/login` with:
- public authentication entry;
- anti-abuse required across IP, identity, device, account, endpoint and global scopes;
- possible actions `ALLOW`, `THROTTLE`, `CHALLENGE`, `BLOCK`;
- one asynchronous `risk_or_security_audit` task;
- no credential logging/return;
- constant failure semantics and no account enumeration;
- `risk_challenge_before_expensive_work`;
- refresh rotation required.

The policy currently records anti-abuse, state, integration and security-E2E evidence as incomplete. Therefore these declarations are contract requirements, not proof of execution.

## Existing product contract

The Security Center contract defines the suspicious-login journey as:
`Detection → Alert → Verify → Protect → Revoke/Continue → Audit`.
It explicitly keeps Risk Decision authority in the Risk domain and Session authority in Identity/Auth. The Security Center must not create a second Risk authority.

## Mapping decision

For the next closure stage, `authLogin` is the entry point where risk evaluation is consumed, but the risk decision itself must remain an authoritative Risk-domain state/decision. Do not introduce an `AUTH-012` session entity or duplicate `ENT-SESSION`.

Required mapping shape:

`authLogin request`
→ authentication attempt context
→ server-side risk evaluation
→ risk decision/action
→ ALLOW / CHALLENGE / BLOCK or other explicitly frozen action
→ session issuance only when allowed
→ security audit / alert projection when required

The exact Risk entity/state/action identifiers remain unresolved and must be discovered from existing canonical contracts before implementation.

## Security invariants

1. Client input cannot set or override the authoritative risk decision.
2. Risk scores and detection rules are internal and are never returned as public DTO fields.
3. Authentication failure behavior must not reveal whether an account exists.
4. A risk challenge must occur before expensive authentication/session work when the policy requires it.
5. A risk-triggered session revocation must use the canonical session authority and dominate stale cache.
6. Security mutations must be attributable to request/correlation context and auditable.
7. Replayed sensitive mutations must obey the canonical idempotency contract.

## Evidence requirements

AUTH-012 cannot become GREEN until all of the following have executable evidence:

- canonical Risk decision/state contract;
- authLogin handler binding;
- anti-abuse enforcement;
- persistence/state transition evidence where applicable;
- challenge/protect/revoke integration;
- security audit evidence;
- account-enumeration negative test;
- client risk-decision override negative test;
- risk-triggered revoke versus stale-cache test;
- Evidence Registry execution record.

An empty Evidence Registry is a hard failure, regardless of how complete the documents appear.

## Current gate

`AUTH-012 = BLOCKED_NOT_GREEN`.

Next closure action is discovery/reconciliation of the existing canonical Risk decision/state contracts. No new Risk authority should be invented while that search remains incomplete.
