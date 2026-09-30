# LuckRead Taxonomy / Topic / Hashtag / Entity Test & Acceptance Contract v1.0

**状态：TEST-ACCEPTANCE-COMPLETE / IMPLEMENTATION PENDING**

## 1. P0 Cases

| ID | Scenario | Expected |
|---|---|---|
| TAX-001 | create taxonomy node | stable unique identity |
| TAX-002 | classify content | valid auditable edge |
| TAX-003 | normalize hashtag | deterministic canonical result |
| TAX-004 | alias resolution | one canonical topic |
| TAX-005 | duplicate topic | rejected/deduplicated |
| TAX-006 | topic merge | references migrate with provenance |
| TAX-007 | topic split | new canonical identities are explicit |
| TAX-008 | restrict topic | downstream consumers receive policy state |
| TAX-009 | private classification | unauthorized reads blocked |
| TAX-010 | localized topic | no duplicate authority |
| TAX-011 | trend state change | treated as derived state |
| TAX-012 | replay event | no duplicate authority |
| TAX-013 | search rebuild | derived index recoverable |
| TAX-014 | recommendation rebuild | derived rank recoverable |
| TAX-015 | creator-defined tag | cannot bypass platform policy |
| TAX-016 | rate limit | abusive public resolution blocked |
| TAX-017 | audit | privileged mutations produce evidence |

## 2. Reliability

Must cover concurrent topic creation, merge races, stale versions, out-of-order events, retries, DLQ and replay.

## 3. Evidence

```text
caseId
commitSha
environment
input/reference
result
timestamp
failureClass
```

Any P0 case that is FAIL or BLOCKED prevents READY.
