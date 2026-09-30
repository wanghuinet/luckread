# Phase 8 — Moderation / Operations / Production Hardening Mapping v1.0

**Status:** MAPPING_BASELINE / NOT_GREEN_UNTIL_EVIDENCE

## Scope
### Moderation
- Content moderation states
- User/account moderation
- Reports
- Review queues
- Appeals
- Administrative decisions
- Moderation audit trail

### Operations
- Admin roles and scopes
- Operational dashboards
- Audit logs
- Content/user operations
- Incident workflows
- Configuration/change management

### Production hardening
- Security hardening
- Abuse protection
- Rate limiting
- Load/concurrency testing
- Failure injection
- Recovery and rollback
- Database migration/rollback validation
- Observability and alerting
- Performance validation
- Cost controls
- Disaster recovery
- Production readiness evidence

## End-to-end closure
`User/content -> Report/automatic signal -> Review -> Decision -> Enforcement -> Appeal -> Audit`

`Production change -> CI gates -> Deployment -> Health verification -> Observability -> Rollback/recovery when required`

## Required mappings
O01 moderation model; O02 report; O03 review; O04 enforcement; O05 appeal; O06 admin authorization; O07 audit; O08 incident; O09 security hardening; O10 load/performance; O11 failure injection; O12 recovery; O13 rollback; O14 migration; O15 observability; O16 alerting; O17 cost; O18 disaster recovery; O19 production readiness.

## Invariants
- Administrative capability is scoped and auditable.
- Moderation decisions have actor, reason/state and audit evidence.
- Production changes are traceable to source revision and CI evidence.
- Recovery procedures are tested rather than documented only.
- Security controls cannot be bypassed through internal/local endpoints.

## Exit gate
Phase 8 is complete only after production hardening tests, recovery evidence, security validation, operational controls and deployment evidence are green.
