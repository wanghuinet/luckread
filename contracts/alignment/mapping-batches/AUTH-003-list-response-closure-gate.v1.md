# AUTH-003 List Response Closure Gate v1

**Status:** BLOCKED_NOT_GREEN
**Feature:** AUTH-003 Credential Management
**Scope:** `DTO-AUTH-003-CREDENTIAL-LIST-RESPONSE`
**Authority rule:** fail-closed; no inferred public fields or domain-specific pagination values.

## 1. Confirmed global list contract

The mandatory LuckRead API Error / Pagination / Cursor Contract establishes the public list envelope:

- `data.items`
- `data.nextCursor`
- `data.hasMore`
- `requestId`
- optional `traceId`

It also establishes cursor pagination as the default for growing/high-volume collections, canonical query parameters `cursor` and `limit`, opaque cursors, endpoint/query/order binding, deterministic ordering, stable tie-breakers, empty-result success, and canonical `INVALID_CURSOR` / `CURSOR_EXPIRED` errors.

The common maximum is 100 unless a stricter domain contract is explicitly declared.

## 2. AUTH-003-specific closure audit

| Dimension | Result | Authority status |
|---|---|---|
| Response envelope | `data.items` + `nextCursor` + `hasMore` + request/trace IDs | CLOSED by global contract |
| Pagination strategy | cursor | CLOSED by global contract default |
| Query parameters | `cursor`, `limit` | CLOSED by global contract |
| Empty result | successful empty list | CLOSED by global contract |
| Cursor binding | endpoint + effective query/filter + deterministic order | CLOSED by global contract |
| Invalid cursor | `INVALID_CURSOR` | CLOSED by global contract |
| Expired cursor | `CURSOR_EXPIRED` | CLOSED by global contract |
| Common maximum | 100 unless stricter contract exists | GLOBAL DEFAULT ONLY |
| AUTH-003 default limit | unresolved | NOT AUTHORIZED |
| AUTH-003 maximum limit | unresolved | NOT AUTHORIZED |
| Item public fields | unresolved | NOT AUTHORIZED |
| Item field requiredness | unresolved | NOT AUTHORIZED |
| Item ordering | unresolved | NOT AUTHORIZED |
| Ordering tie-breaker | unresolved until ordering selected | NOT AUTHORIZED |

## 3. Public item field audit

`ENT-CREDENTIAL` field definitions do not authorize automatic public projection. In particular:

- `identityId`: internal relation; public projection is not authorized.
- `valueHash`: secret-derived material; public projection is forbidden.
- `normalizedValue`: authentication identifier; public projection is forbidden.
- credential raw value: never returned.
- `verifiedAt`: public exposure requires explicit response authorization.
- `active`: public exposure remains unresolved for AUTH-003 response.
- `createdAt` / `updatedAt`: entity fields do not by themselves authorize public response exposure.
- `kind`: allowed values exist at entity level, but public exposure is forbidden unless explicitly required by the AUTH response contract.
- `id`: internal identifier; public exposure is not automatically authorized.

Therefore the list item shape remains unresolved.

## 4. No-inference decisions

The following are explicitly NOT promoted:

- `limit=20`, `50`, `100`, or any other AUTH-003-specific default.
- `createdAt DESC, id DESC` or any other ordering.
- `id`, `kind`, `active`, `verifiedAt`, `createdAt`, or `updatedAt` as public item fields.
- any `credentialId` representation in the list item.
- any masked email/phone/username representation.

The global contract supplies protocol conventions but does not supply AUTH-003's domain-specific item projection or ordering choice.

## 5. Promotion gate

AUTH-003 List Response may not enter the canonical DTO Registry, OpenAPI, or Mapping-0 as GREEN until an authoritative feature-level source explicitly resolves:

1. public item fields;
2. field requiredness/nullability;
3. default limit;
4. maximum limit;
5. deterministic ordering;
6. stable tie-breaker;
7. corresponding OpenAPI schema;
8. executable contract evidence bound to the tested commit SHA.

**Conclusion:** global pagination protocol is CLOSED; AUTH-003 domain list projection and ordering remain BLOCKED_NOT_GREEN.
