# Luckread Pre-Contract Closure — Step 6

Status: **ACTIVE / PRE-CONTRACT / STEP 6 OF 8**

## Objective

Define the canonical mapping registry required before Contract freeze.

## Canonical graph

`Feature → Capability → API Operation → DTO → Entity → Database Field/Persistence → Payload Origin → Code → Security → Lifecycle → Test/Evidence`

## Mapping requirements

Each relationship must be one of:

- `MATCH`
- `MAPPED`
- `MISSING`
- `EXTRA`
- `DRIFT`
- `CONFLICT`
- `DUPLICATE`
- `UNRESOLVED`
- `BLOCKED`

## Cardinality rules

1. A Feature has one canonical owner.
2. A Capability has one canonical owner and may expose multiple APIs.
3. An API may consume/produce multiple DTO fields, but each field must map to an authorized domain meaning.
4. An Entity field must have an owning persistence contract or explicit infrastructure classification.
5. Payload configuration cannot create an independent business authority.
6. Code cannot become a new capability merely because it exists.
7. One business responsibility cannot be silently implemented twice.
8. Derived systems such as search, feed, cache and analytics must point back to their source of truth.

## Minimum registry record

```text
mappingId
featureId
capabilityId
apiOperationId
requestDtoId
responseDtoId
entityId
persistenceId
payloadOrigin
codeOwner
securityId
lifecycleId
testId
evidenceRefs
status
blockers
```

## Freeze rule

A mapping is Contract-ready only when all required nodes and edges are `MATCH` or `MAPPED`, with no unresolved blocking relationship.

Step 6 does not rewrite the historical model merely to achieve a match. Conflicts must be resolved by authoritative source selection or formal change control.

## Handoff

Step 7 will classify drift/conflict/duplicate/missing relationships and calculate change impact from this graph.
