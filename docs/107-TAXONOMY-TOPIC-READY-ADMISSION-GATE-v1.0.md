# LuckRead Taxonomy / Topic / Hashtag / Entity Ready Admission Gate v1.0

**状态：ADMISSION-CONTRACT-COMPLETE / IMPLEMENTATION BLOCKED UNTIL UNIFIED CL**  
**定位：100–106 Taxonomy/Topic 合同链最终准入门**

## 1. Contract Chain

```text
100 Capability Contract
→ 101 L1-L4 Traceability
→ 102 Data Contract
→ 103 API Contract
→ 104 Event Contract
→ 105 Permission/Security
→ 106 Test/Acceptance
→ 107 Final Admission
```

## 2. Mandatory Gates

### G1 Capability

8 个 L2 必须完整：

```text
Taxonomy
Topic
Hashtag
Entity Classification
Content Classification
Trending / Topic Lifecycle
Localization
Governance
```

### G2 Authority

```text
Taxonomy / Topic / Hashtag / Classification
→ Taxonomy/Topic System
```

Content、Creator、IP、Search、Recommendation、Risk、Moderation、Commerce 保持各自权威。

### G3 Consistency

必须保证：

```text
canonical topic uniqueness
alias uniqueness
classification provenance
versioned merge/split
privacy/policy enforcement
rebuildable derived indexes
```

### G4 Security

必须验证 owner scope、organization scope、external app scope、privacy、policy、privileged taxonomy administration 与 audit。

### G5 Reliability

必须验证：

```text
duplicate creation
concurrent merge
stale version
out-of-order event
retry
DLQ
replay
```

### G6 Cross-Domain Reconciliation

必须与以下合同一致：

```text
10 Content/IP
43 Creator Center
53 Search/Discovery
55 Feed/Recommendation
62 Risk/Trust
63 Moderation
64 Rights
65 Commerce
69 Analytics
70 Open Platform
71 Platform Operations
74 Final Reconciliation
75 Unified Preflight
92-99 Distribution
```

## 3. Code Admission Rules

Unified CL/CI 通过前不得：

- 建立第二 Topic/Taxonomy authority；
- 将 Search index 当作 Topic authority；
- 将 trending score 当作永久 Topic fact；
- 用分类边关系授予版权/所有权；
- 绕过 policy/moderation/privacy；
- 建立未注册 relation/classification type。

## 4. Final Decision

```text
PASS
FAIL
BLOCKED
```

只有：

```text
100–106 PASS
→ Cross-domain reconciliation PASS
→ Unified CL PASS
→ CI PASS
→ READY
```

才允许正式 IMPLEMENTATION。

## 5. Current State

```text
CAPABILITY        = COMPLETE
TRACEABILITY      = COMPLETE
DATA              = COMPLETE
API               = COMPLETE
EVENT             = COMPLETE
SECURITY          = COMPLETE
TEST / ACCEPTANCE = COMPLETE
FINAL GATE        = DEFINED
IMPLEMENTATION    = BLOCKED UNTIL UNIFIED CL
CL / CI           = NOT RUN
```
