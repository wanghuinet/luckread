# LuckRead L5/L6 Identity & Session Instance Registry v1.0

**状态：INSTANCE-CLOSED-FOR-SCOPE / IMPLEMENTATION-PENDING / CL-CI-NOT-RUN**

## 0. Scope

本实例包把 36 Fourth-Level Capability Matrix 中 Identity、Device / Session / Privacy 的现有 L4 显式展开为 L5 与 L6。

仅覆盖本文件列出的 L4；未列出的 L4 不得推定为 CLOSED。

## 1. Instance rule

```text
L4
→ L5 execution specification
→ L6 verification claims
→ contract refs
→ test/evidence refs
```

## 2. Registry

| L4 | L5 | L6 minimum claims |
|---|---|---|
| normalize email before lookup | normalize-email-01 | same canonical input; invalid format rejected; normalization is deterministic |
| normalize username before lookup | normalize-username-01 | canonical form deterministic; forbidden charset rejected; equivalent forms resolve identically |
| validate username length/charset | validate-username-01 | min/max enforced; invalid charset rejected; valid boundary accepted |
| reserve unique username | reserve-username-01 | duplicate denied; successful reservation unique; retry is idempotent |
| reserve unique email | reserve-email-01 | duplicate denied; successful reservation unique; retry is idempotent |
| issue verification token | issue-verification-token-01 | token issued once per request; expiry assigned; secret not logged |
| hash verification token | hash-verification-token-01 | stored value is not plaintext; verification uses matching hash; raw token absent from persistence |
| expire verification token | expire-verification-token-01 | expired token rejected; expired state deterministic; no reuse after expiry |
| consume verification token once | consume-verification-token-01 | first valid consume succeeds; second consume fails; concurrent consume cannot double-apply |
| reject duplicate registration | reject-duplicate-registration-01 | existing identity rejected; error normalized; no duplicate account created |
| enforce registration rate limit | registration-rate-limit-01 | limit enforced; Retry-After/limit signal consistent; trusted server path cannot bypass |
| record registration security event | registration-security-event-01 | event emitted on required security outcome; correlation preserved; sensitive secret absent |
| normalize login identifier | normalize-login-identifier-01 | normalization deterministic; unknown identifier handled safely; canonical lookup used |
| verify password hash | verify-password-hash-01 | correct password succeeds; incorrect password fails; hash never exposed |
| create authenticated session | create-session-01 | valid auth creates session; session bound to actor; credential not exposed in logs |
| rotate session credential | rotate-session-01 | old credential invalid after rotation; new credential valid; replay blocked |
| revoke current session | revoke-current-session-01 | current session becomes unusable; audit recorded; unrelated sessions remain valid unless policy says otherwise |
| revoke all sessions | revoke-all-sessions-01 | all active sessions revoked; operation idempotent; completion observable |
| increment failed-login counter | failed-login-counter-01 | failed attempt increments; successful auth does not increment; counter scope correct |
| reset failed-login counter on success | reset-login-counter-01 | successful auth resets counter; concurrent updates do not resurrect stale count |
| evaluate lockout threshold | lockout-threshold-01 | threshold decision deterministic; below threshold remains allowed; threshold crossing produces policy state |
| normalize authentication errors | auth-error-normalization-01 | stable error code; no credential disclosure; response shape consistent |
| read authorized profile projection | profile-read-01 | authorized fields returned; forbidden fields omitted; scope enforced |
| validate display name | validate-display-name-01 | length boundary enforced; invalid content rejected; normalization deterministic |
| update display name | update-display-name-01 | authorized update persists; version conflict detected; repeat safe where idempotent |
| update avatar reference | update-avatar-reference-01 | reference authorized; invalid reference rejected; update emits required change signal |
| validate bio length | validate-bio-01 | max length enforced; valid boundary accepted; oversized input rejected |
| update bio | update-bio-01 | authorized update persists; unauthorized mutation denied; version semantics enforced |
| validate locale | validate-locale-01 | supported locale accepted; unsupported locale rejected; fallback deterministic |
| update locale | update-locale-01 | authorized update persists; policy version captured; read model reflects current locale |
| validate timezone | validate-timezone-01 | supported timezone accepted; malformed value rejected; DST-safe identifier preserved |
| update timezone | update-timezone-01 | authorized update persists; timestamps remain canonical; current setting readable |
| update profile visibility | update-profile-visibility-01 | allowed values only; authorization enforced; projection follows new visibility |
| verify current credential | verify-current-credential-01 | correct credential succeeds; incorrect credential fails; attempts are rate-limited |
| issue password-reset request | password-reset-request-01 | request creates durable operation/token boundary; response does not reveal account existence; rate limit enforced |
| issue password-reset token | password-reset-token-01 | token expires; token stored safely; raw token not logged |
| validate reset token | validate-reset-token-01 | valid token accepted; expired token rejected; wrong-use context rejected |
| consume reset token once | consume-reset-token-01 | first consume succeeds; reuse fails; concurrent consume cannot double-reset |
| replace password hash | replace-password-hash-01 | new hash verifies; old credential invalid; secret absent from telemetry |
| revoke compromised credentials | revoke-compromised-credential-01 | compromised credential unusable; sessions follow policy; audit evidence exists |
| record security event | security-event-record-01 | required event persisted/emitted; actor correlation retained; sensitive values redacted |
| emit suspicious-login notification | suspicious-login-notification-01 | notification emitted on qualifying event; destination scoped; duplicate notification policy deterministic |
| resolve role | resolve-role-01 | role resolution deterministic; scope applied; missing role denied by default |
| validate role transition | validate-role-transition-01 | unauthorized transition denied; valid transition accepted; audit recorded |
| validate resource owner | validate-resource-owner-01 | owner access succeeds; non-owner denied; delegated access not conflated with ownership |
| resolve delegated permission | resolve-delegated-permission-01 | delegation scope bounded; expired delegation denied; revocation effective |
| evaluate resource policy | evaluate-resource-policy-01 | policy version applied; deny-by-default; decision reproducible |
| authorize operator action | authorize-operator-action-01 | permitted operator scope succeeds; cross-scope denied; audit required |
| authorize admin action | authorize-admin-action-01 | privileged action requires explicit policy; unauthorized admin action denied; audit retained |
| deny by default | deny-by-default-01 | missing authorization denies; missing scope denies; failure has stable error |
| create consent record | create-consent-01 | policy version stored; actor/resource scope correct; duplicate submission deterministic |
| attach consent policy version | attach-consent-version-01 | version immutable for record; current policy retrievable; invalid version rejected |
| withdraw consent | withdraw-consent-01 | withdrawal persists; downstream policy propagation triggered; history retained |
| query consent history | query-consent-history-01 | caller only sees authorized history; ordering deterministic; immutable history preserved |
| update marketing preference | marketing-preference-01 | authorized change persists; locale/policy applied; audit retained |
| resolve regional policy | regional-policy-01 | region source deterministic; applicable policy selected; unsupported region has defined fallback |
| prevent unauthorized consent mutation | consent-authorization-01 | unauthorized mutation denied; no state change; denial observable |
| transition active→restricted | account-restrict-01 | valid transition succeeds; invalid source denied; state change audited |
| transition active→suspended | account-suspend-01 | valid transition succeeds; invalid source denied; enforcement side effects follow policy |
| transition active→deactivated | account-deactivate-01 | state change persists; access blocked according to policy; lifecycle evidence retained |
| create deletion request | account-delete-request-01 | request durable; eligibility checked; duplicate request idempotent |
| validate deletion eligibility | deletion-eligibility-01 | legal hold blocks deletion where required; disallowed state rejected; decision auditable |
| enqueue deletion | deletion-enqueue-01 | operationId created; duplicate enqueue safe; queue item references authority |
| execute deletion steps | deletion-execution-01 | deletion follows 160; derived data propagation triggered; final state verifiable |
| validate restoration eligibility | restoration-eligibility-01 | only permitted states restorable; legal/policy constraints applied; decision auditable |
| restore account | account-restoration-01 | eligible account restored; unauthorized restore denied; state/version consistent |
| audit lifecycle transition | lifecycle-audit-01 | every privileged transition auditable; actor/resource correlation retained; sensitive data redacted |

## 3. Device / Session / Privacy

| L4 | L5 | L6 minimum claims |
|---|---|---|
| create device record | device-create-01 | device bound to actor/session; duplicate device handling deterministic; privacy-safe identifier used |
| rotate privacy-safe device reference | device-reference-rotation-01 | new reference valid; old reference cannot impersonate device; mapping protected |
| update device label | device-label-01 | authorized update persists; length policy enforced; unrelated device fields unchanged |
| mark trusted | trust-device-01 | explicit policy required; trusted state scoped to actor/device; audit exists |
| revoke trust | revoke-device-trust-01 | trust removed immediately per policy; revoked device cannot silently regain trust |
| list active devices | list-active-devices-01 | only actor-authorized devices returned; revoked devices excluded; pagination stable |
| remove revoked device references | remove-revoked-device-ref-01 | obsolete reference removed safely; live device mapping preserved; cleanup repeatable |
| issue session | device-session-issue-01 | authenticated actor gets session; scope bound; expiry assigned |
| issue refresh credential | refresh-credential-issue-01 | credential tied to session; expiry assigned; secret not logged |
| rotate refresh credential | refresh-credential-rotate-01 | old credential rejected; new credential valid; replay blocked |
| expire session | session-expire-01 | expired session rejected; expiry deterministic; refresh path follows policy |
| revoke session | session-revoke-01 | revoked session rejected; audit recorded; neighboring sessions unaffected unless required |
| evaluate concurrent-session limit | concurrent-session-policy-01 | policy deterministic; excess sessions handled according to contract; no silent privilege escalation |
| list sessions | session-list-01 | only caller-owned/authorized sessions returned; revoked sessions classified; pagination stable |
| bind session to device | session-device-bind-01 | binding scoped; mismatched device denied; binding change auditable |
| record login event | login-event-01 | required fields recorded; correlation preserved; sensitive credential absent |
| compare known device | known-device-compare-01 | comparison deterministic; privacy-safe reference used; unknown device enters risk boundary |
| aggregate login risk signals | login-risk-aggregate-01 | signals scoped; aggregation reproducible; risk decision not exposed as secret |
| invoke impossible-travel boundary | impossible-travel-boundary-01 | boundary invoked only with sufficient signals; uncertain data does not force false certainty |
| issue challenge | login-challenge-01 | challenge scoped/expiring; replay prevented; challenge result auditable |
| escalate takeover risk | takeover-escalation-01 | escalation state deterministic; sessions/actions follow policy; audit exists |
| revoke compromised sessions | compromised-session-revoke-01 | compromised sessions invalidated; operation idempotent; security evidence retained |
| validate email ownership | email-ownership-01 | proof tied to identity; replay blocked; result auditable |
| bind email | email-bind-01 | verified email required; uniqueness enforced; prior binding handled by policy |
| unbind email under policy | email-unbind-01 | policy prerequisites enforced; last-recovery-factor rule respected; audit retained |
| bind phone through provider boundary | phone-bind-01 | provider boundary enforced; verification required; raw provider secret never stored |
| unbind phone through provider boundary | phone-unbind-01 | authorization enforced; recovery impact evaluated; audit retained |
| register passkey through supported provider | passkey-register-01 | provider boundary used; credential not exposed; duplicate registration handled |
| authenticate passkey | passkey-auth-01 | valid assertion succeeds; invalid/replayed assertion fails; credential secret remains protected |
| link external identity | external-identity-link-01 | provider identity unique to scope; authorization required; unlink path available |
| unlink external identity | external-identity-unlink-01 | authorization required; recovery impact checked; audit retained |
| resolve profile audience | profile-audience-01 | audience decision deterministic; scope honored; denied fields suppressed |
| resolve default content audience | content-audience-default-01 | default applies only where allowed; policy version captured; mutation auditable |
| resolve interaction visibility | interaction-visibility-01 | visibility rule deterministic; viewer scope enforced; sensitive interaction hidden when required |
| resolve follower visibility | follower-visibility-01 | configured audience honored; blocked scopes excluded; result reproducible |
| resolve presence visibility | presence-visibility-01 | privacy preference honored; unauthorized presence hidden; propagation bounded |
| apply personalization opt-out | personalization-optout-01 | opt-out blocks applicable personalization; decision propagated; prior derived use is handled per policy |
| propagate privacy decision to consumers | privacy-propagation-01 | consumers receive current version; duplicate propagation safe; stale policy cannot become authoritative |
| create export request | export-request-01 | durable operation created; authorization checked; duplicate request deterministic |
| authorize export request | export-authorization-01 | current scope evaluated; cross-user data excluded; denial auditable |
| generate export snapshot | export-snapshot-01 | snapshot bound to authorization/version; sensitive data protected; source references traceable |
| deliver export | export-delivery-01 | only authorized recipient receives export; expiry enforced; delivery auditable |
| create deletion request | privacy-delete-request-01 | request durable; eligibility checked; operationId assigned |
| evaluate retention rule | retention-evaluation-01 | current policy version used; Legal Hold recognized; result reproducible |
| execute deletion job | privacy-delete-job-01 | 160 propagation semantics followed; failed steps retryable; completion verifiable |
| write privacy audit record | privacy-audit-01 | actor/resource/action recorded; sensitive fields redacted; record immutable |
| resolve regional data policy | regional-data-policy-01 | jurisdiction source deterministic; policy version captured; unsupported region handled explicitly |

## 4. Cross-Cutting Inheritance

All applicable instances inherit:

```text
160 Lifecycle
163 Event semantics
165 Async operation
166 Error / State
168 Scope / Tenant
169 Security / Incident
170 Rate / Quota
171 Observability
172 Localization
173 Accessibility where user-facing
174 Canonical ID
175 Configuration / Policy
176 Evidence
```

## 5. Readiness

本实例包的 scope 内：

```text
L4 inventory reference = CLOSED
L5 instance coverage    = CLOSED
L6 minimum claims       = CLOSED
Contract refs           = REQUIRED BEFORE READY
Test refs               = REQUIRED BEFORE READY
Evidence                = REQUIRED BEFORE PASS
Implementation          = NOT AUTHORIZED
CL                      = NOT RUN
CI                      = NOT RUN
```

## 6. STOP

- L4 not present in authoritative 36/178 inventory;
- multiple L5 parents;
- missing L6 claim;
- authorization/lifecycle/security inheritance not classified;
- evidence planned but not linked;
- instance marked READY without all required contract references.
