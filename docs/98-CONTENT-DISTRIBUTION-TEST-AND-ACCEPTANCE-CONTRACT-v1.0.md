# LuckRead Content Distribution Test & Acceptance Contract v1.0

**状态：TEST-ACCEPTANCE-COMPLETE / IMPLEMENTATION PENDING**

## 1. P0 Acceptance Matrix

| ID | Scenario | Expected |
|---|---|---|
| DIST-001 | single target publish | delivery state transitions correctly |
| DIST-002 | multi-target fanout | each target has independent status |
| DIST-003 | duplicate submit | one authoritative distribution record |
| DIST-004 | unauthorized publish | rejected |
| DIST-005 | ineligible content | delivery never starts |
| DIST-006 | rights revoked before dispatch | target blocked/withdrawn |
| DIST-007 | scheduled delivery | executes within defined window |
| DIST-008 | timeout | bounded retry, no duplicate delivery |
| DIST-009 | partial failure | partial state retained and recoverable |
| DIST-010 | stale version | newer canonical version protected |
| DIST-011 | withdrawal | registered targets converge to withdrawn state |
| DIST-012 | replay | safe replay without duplicate authority |
| DIST-013 | downstream search failure | distribution authority remains healthy |
| DIST-014 | downstream recommendation failure | distribution authority remains healthy |
| DIST-015 | high fanout | request does not synchronously wait for all targets |
| DIST-016 | private content | no unauthorized exposure |
| DIST-017 | audit | sensitive mutations produce evidence |
| DIST-018 | region restriction | disallowed target is blocked |
| DIST-019 | external app scope | scope cannot escape granted target |
| DIST-020 | rebuild | derived distribution views can be recreated |

## 2. Reliability Tests

Must cover:

```text
duplicate
concurrency
out-of-order
timeout
retry
DLQ
replay
withdraw race
channel outage
version replacement
```

## 3. Performance / Cost Tests

- bounded synchronous request path;
- queue-backed fanout;
- no unbounded target scan;
- hot status may use Cache/KV;
- downstream failure does not create write amplification loops.

## 4. Security Tests

Verify owner isolation, delegated scope, organization scope, external-app scope, privacy enforcement, Rights revalidation and audit completeness.

## 5. Evidence

Each acceptance case must emit machine-readable evidence:

```text
caseId
commitSha
environment
input/reference
result
timestamp
failureClass
```

## 6. Release Gate

All mandatory P0 cases must PASS before distribution implementation can be declared READY. A BLOCKED test is not PASS.
