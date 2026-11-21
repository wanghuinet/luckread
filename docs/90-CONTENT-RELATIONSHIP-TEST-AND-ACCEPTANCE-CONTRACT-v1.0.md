# LuckRead Content Relationship Test & Acceptance Contract v1.0

**状态：TEST-ACCEPTANCE-COMPLETE / IMPLEMENTATION PENDING**

## 1. Test Layers

```text
Unit
→ Contract
→ Integration
→ Event
→ Permission/Security
→ Recovery/Rebuild
→ E2E
```

## 2. P0 Acceptance Matrix

| ID | Scenario | Expected |
|---|---|---|
| CR-001 | create reference | one valid relationship |
| CR-002 | create quote | source/target/type valid |
| CR-003 | repost | attribution retained |
| CR-004 | remix | provenance + authorization reference present |
| CR-005 | derivative | derivative source recorded |
| CR-006 | translation | language pair + source recorded |
| CR-007 | duplicate command | no duplicate authority |
| CR-008 | concurrent creation | deterministic conflict handling |
| CR-009 | unauthorized mutation | rejected |
| CR-010 | private relation read | privacy preserved |
| CR-011 | rights revoked | downstream consumers revalidate |
| CR-012 | source deletion | relation enters defined invalid/restricted state |
| CR-013 | provenance dispute | auditable dispute lifecycle |
| CR-014 | event duplicate | consumer remains idempotent |
| CR-015 | event replay | projection reconstructed consistently |
| CR-016 | index outage | relationship write remains available |
| CR-017 | projection rebuild | counts/checksums converge |
| CR-018 | payload boundary | no Payload internals exposed |

## 3. Evidence

每个 P0 case 必须产生 machine-readable evidence：

```text
testId
contractVersion
commitSha
input
expected
actual
result
timestamp
```

## 4. Negative Tests

必须覆盖：invalid relation type、missing source/target、owner mismatch、visibility denial、rights authorization missing、version conflict、duplicate idempotency key、rate limiting、replay。

## 5. Acceptance Rule

任何 P0 失败均为 `FAIL`，不得通过删除测试或放宽 expected 值转为 PASS。
