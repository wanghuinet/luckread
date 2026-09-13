# P0 Security Adversarial Validation v1.0

Status: DEFINED / EXECUTION-BLOCKED-UNTIL-IMPLEMENTATION

## Purpose

Turn the security contracts into executable negative-security evidence. A defined case is never considered PASS until executed against real implementation.

## Mandatory cases

### Authorization / IDOR
- AUTH-001 anonymous protected resource -> DENY
- AUTH-002 user A -> user B resource -> DENY
- AUTH-003 non-privileged user -> privileged action -> DENY
- AUTH-004 role injection -> DENY
- AUTH-005 status injection -> DENY
- AUTH-006 verified injection -> DENY
- AUTH-007 owner_id injection -> DENY
- AUTH-008 organization_id injection -> DENY
- AUTH-009 scope_id injection -> DENY
- AUTH-010 known resource ID without authorization -> DENY

### Tenant / Scope
- TENANT-001 organization A -> organization B resource -> DENY
- TENANT-002 organization A -> organization B analytics -> DENY
- TENANT-003 organization A -> organization B media -> DENY
- TENANT-004 organization A -> organization B IP resource -> DENY

### Revocation / State
- REV-001 permission revoke -> immediate DENY
- REV-002 membership revoke -> immediate DENY
- REV-003 credential revoke -> immediate DENY
- REV-004 entitlement revoke -> immediate DENY
- REV-005 delegation expiry -> immediate DENY
- REV-006 suspended account -> DENY
- REV-007 locked account -> DENY

### Payload boundary
- PAYLOAD-001 Payload admin without public authorization -> DENY
- PAYLOAD-002 Local API without valid public authorization context -> DENY
- PAYLOAD-003 public DENY + Payload ALLOW -> DENY
- PAYLOAD-004 public ALLOW + Payload DENY -> DENY

### Concurrency / race
- RACE-001 permission revoke during 100 concurrent requests
- RACE-002 ownership transfer during 100 concurrent requests
- RACE-003 membership removal during 100 concurrent requests
- RACE-004 credential revoke during 100 concurrent requests
- RACE-005 entitlement expiry during 100 concurrent requests

## Evidence

Every executed case must record:

`case_id, commit_sha, contract_sha, policy_version, authorization_version, request_id, trace_id, subject, action, resource, expected, actual, timestamp, result`

A case is PASS only when `expected == actual` and the execution artifact is retained.

Missing execution evidence is NOT PASS.

## Security Green rule

`SECURITY_GREEN` remains BLOCKED until all mandatory applicable adversarial cases execute successfully and evidence is validated by CI.

## Prohibited claims

- Contract presence is not runtime security proof.
- Static scan success is not E2E security proof.
- Payload authentication is not public API authorization proof.
- A cached ALLOW is not proof after authoritative revocation.
