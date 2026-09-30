# LuckRead Content Distribution Permission & Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authorization Chain

```text
Authentication
→ Actor
→ Session / App Scope
→ Creator / Organization Ownership
→ Distribution Permission
→ Content Visibility Check
→ Rights Check
→ Moderation / Safety Check
→ Policy / Region Check
→ Mutation
→ Audit
```

## 2. Roles

At minimum:

```text
Content Owner
Creator
Organization Admin
Editor
Publisher
Moderator
Platform Operator
External App
```

External applications may only operate within granted scopes and never gain direct access to internal storage.

## 3. Protected Operations

Require elevated permission and audit:

- publish on behalf of another creator;
- external syndication;
- cross-region distribution;
- mass dispatch;
- emergency withdrawal;
- bulk replay;
- override of normal schedule.

## 4. Privacy

Distribution must respect content visibility, audience restrictions, blocked users/regions and account restrictions. Private content must never become public merely because a delivery target exists.

## 5. Rights

Distribution is not proof of legal ownership. Any legally constrained target requires a fresh Rights authority check or valid authorization reference.

## 6. Replay / Abuse Protection

Every mutation uses idempotency and bounded retry. Replay endpoints require operator authorization and must not widen original scope.

## 7. Audit

Record:

```text
actorId
scope
action
contentId
distributionId
targetId
result
reason
timestamp
requestId
correlationId
```

Sensitive evidence is referenced, not copied into ordinary logs.

## 8. STOP

- scope bypass;
- private content leakage;
- rights check bypass;
- external app direct storage access;
- replay privilege escalation;
- unaudited emergency withdrawal.
