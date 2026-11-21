# LuckRead Taxonomy / Topic / Hashtag / Entity Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authoritative Entities

```text
taxonomy
taxonomy_node
topic
hashtag
entity_reference
classification_edge
trend_state
localization_variant
```

## 2. Core Invariants

- IDs are immutable.
- Canonical topic identity is unique within defined scope.
- Alias points to exactly one canonical topic at a time.
- Classification edges have explicit source/provenance.
- Policy state is separate from trend state.
- Derived popularity/trending metrics are not authoritative topic facts.
- Merge/split operations are versioned and auditable.

## 3. Retention / Rebuild

Historical governance changes must be retained sufficiently for audit and migration. Search/Feed/Recommendation projections must be rebuildable from taxonomy and classification authority plus events.

## 4. Privacy

User-created private labels and sensitive entity associations must follow the subject's visibility policy. Sensitive classification evidence must not be exposed through ordinary public APIs.
