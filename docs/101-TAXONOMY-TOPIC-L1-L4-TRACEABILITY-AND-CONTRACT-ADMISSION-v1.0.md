# LuckRead Taxonomy / Topic L1-L4 Traceability & Contract Admission v1.0

**状态：TRACEABILITY-COMPLETE / CONTRACT-ADMISSION-READY / IMPLEMENTATION PENDING**

## 1. Chain

```text
L1 Taxonomy / Topic / Hashtag / Entity
→ L2
→ L3
→ L4
→ Authority
→ Data
→ API
→ Event
→ Permission/Security
→ Privacy/Policy
→ Runtime/Cost
→ Test/Acceptance
→ Evidence
```

## 2. Coverage

| L2 | L3 | L4 examples |
|---|---|---|
| Taxonomy | tree/classification/lifecycle | category, parent, order, status |
| Topic | identity/scope/lifecycle | topicId, alias, regional state |
| Hashtag | identity/relationship/governance | normalized tag, mapping, policy |
| Entity Classification | entity/alias/confidence | person/org/IP/product refs |
| Content Classification | taxonomy/provenance | category/topic/tag/entity edges |
| Trending | eligibility/surface | freshness, emerging, trending, suppressed |
| Localization | language/regional | localized names, availability |
| Governance | policy/merge/audit | merge, split, restriction |

## 3. Mandatory Rules

Every L4 requires unique owner, authoritative data mapping, versioned API/control mapping, event mapping, permission decision and deterministic acceptance assertion.

## 4. Cross-Domain

```text
Content        → content fact
Creator        → creator fact
IP             → IP fact
Search         → derived index
Feed/Recommend → derived ranking
Risk/Moderation→ policy decision
```

Classification edges never grant ownership or legal rights.

## 5. STOP

- topic duplicate authority;
- alias without canonical target;
- classification without provenance;
- trend treated as permanent fact;
- policy bypass;
- L4 without acceptance/evidence.
