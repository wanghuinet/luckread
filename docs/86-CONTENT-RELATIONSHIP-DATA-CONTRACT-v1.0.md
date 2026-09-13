# LuckRead Content Relationship Data Contract v1.0

**状态：DATA-CONTRACT-COMPLETE / IMPLEMENTATION PENDING**

## 1. Authoritative Entity

```text
ContentRelationship
```

权威字段：

```text
relationshipId
sourceType
sourceId
targetType
targetId
relationType
schemaVersion
status
actorId
provenanceRef
authorizationRef
createdAt
updatedAt
```

## 2. Relation Registry

relationType 必须来自受控注册表，至少支持：

```text
quote
reference
repost
remix
derivative
adaptation
translation
localization
re-edit
version
series-member
collection-member
channel-member
content-ip
series-ip
creator-attribution
production-role
```

## 3. Invariants

1. `relationshipId` immutable。
2. source/target/type/active-version 构成唯一关系键。
3. source 与 target 类型组合必须符合 relation registry。
4. revoked/superseded 关系不可被普通 mutation 重新激活而绕过审计。
5. provenance 变更产生新版本或新的关系事件。
6. authorizationRef 只能引用 Rights authority 的有效授权。
7. derived views 可删除并重建。
8. 不存储本应由其他 authority 保存的完整法律、财务或内容事实。

## 4. Privacy / Retention

关系按 source/target 的最低可见性继承 privacy boundary；敏感关系可单独限制查询。删除遵循法律、审计和业务保留要求。

## 5. Migration / Rebuild

必须支持：

```text
export authoritative relations
→ validate
→ rebuild projections
→ verify counts/checksums
```

关系投影、Search 索引和 Analytics 不得成为迁移源数据。
