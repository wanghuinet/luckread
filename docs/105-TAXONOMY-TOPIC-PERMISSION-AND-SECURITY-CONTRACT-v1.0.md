# LuckRead Taxonomy / Topic Permission & Security Contract v1.0

**状态：SECURITY-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authorization

```text
Authentication
→ Actor
→ Scope
→ Taxonomy/Topic Permission
→ Policy Validation
→ Mutation
→ Audit
```

## 2. Roles

```text
Platform Taxonomy Admin
Moderator
Content Operator
Creator
Organization Operator
External App
```

Creator and external applications may create only permitted scoped labels/topics. Platform-level merge, split, restriction and retirement are privileged operations.

## 3. Safety / Privacy

Restricted topics, sensitive entities and private classifications must obey moderation, region and privacy policy. Classification does not grant content visibility or legal rights.

## 4. Abuse Controls

Public hashtag/topic resolution must be rate limited. Topic creation and mass classification must have quotas and anomaly detection hooks.

## 5. Audit

Privileged actions must record actor, scope, action, resource, reason, timestamp, requestId and correlationId.

## 6. STOP

- creator scope escape;
- external app privilege escalation;
- classification used to bypass visibility;
- un-audited taxonomy governance;
- private classification leakage.
