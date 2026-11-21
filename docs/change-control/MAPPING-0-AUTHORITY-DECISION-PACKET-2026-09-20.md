# Mapping 0 Authority Decision Packet — 2026-09-20

Purpose: provide the single outstanding authority decision surface for the existing 8 OPEN Mapping 0 Change Controls. This packet does not select any option.

## Decision 1 — AUTH-006 status classification
ID: `CC-MAPPING-0-AUTH-006-STATUS-CLASSIFICATION-2026-09-19`

Question: define the machine-decidable canonical predicate that distinguishes `MISSING` from `PARTIAL` for a Mapping row that has some explicit API/Entity edges but lacks downstream closure.

Constraint: do not change the AUTH-006 status until the predicate is authoritative.

## Decision 2 — getEntitlements duplicate operationId
ID: `CC-MAPPING-0-OPENAPI-DUPLICATE-GET-ENTITLEMENTS-2026-09-19`

Question: choose the canonical treatment of:
- `GET /v1/entitlements`
- `GET /v1/entitlements/{subjectId}`

Current conflict: both use `operationId: getEntitlements`; the policy also contains generated `getEntitlementsOp`, which is not present in OpenAPI.

Possible controlled directions already recorded by Change Control:
A. assign a distinct canonical operationId to the collection route;
B. archive/remove the discovery-draft declaration;
C. rename the parameterized operation;
D. formally classify one declaration as a duplicate artifact.

The owner decision must name the canonical operationId/path treatment.

## Decision 3 — DTO representation in Canonical Mapping
ID: `CC-MAPPING-0-DTO-REPRESENTATION-GAP-2026-09-19`

Question:
A. extend the Canonical Mapping schema with an explicit DTO edge; or
B. keep DTO authority external to Canonical Mapping and define closure/reconciliation semantics without a new Mapping edge.

No schema change is authorized before selection.

## Decision 4 — AUTH-003 operationId source
ID: `CC-MAPPING-0-AUTH-003-OPERATION-ID-SOURCE-CONFLICT-2026-09-19`

Question: which operationId vocabulary is authoritative for AUTH-003:
- canonical feature/OpenAPI-side `authCredentialList/authCredentialAdd/authCredentialReplace/authCredentialRemove`; or
- the shared persistence/API/entity/field mapping vocabulary `authUsernameCreate/authUsernameChange/authEmailAdd/authEmailChange/authPhoneAdd/authPhoneChange`.

The owner decision must identify the canonical API/OpenAPI source; dependent DTO/persistence/mapping records are reconciled afterward.

## Decision 5 — AUTH-006 DTO aliases and domain naming
ID: `CC-MAPPING-0-AUTH-006-ALIAS-AND-DOMAIN-CONFLICT-2026-09-19`

Question: select the authoritative AUTH-006 DTO vocabulary and reconcile the corresponding persistence-domain label together with the broader D1-domain decision.

Do not independently rename aliases.

## Decision 6 — Cross-feature D1 domain naming
ID: `CC-MAPPING-0-D1-DOMAIN-NAMING-CONFLICT-2026-09-19`

Scope: AUTH-006, AUTH-013, AUTH-015.

Question: choose one authoritative logical domain label between the existing `D1-01` references and the frozen baseline's `D01 Core` references.

Constraint: this is a logical naming decision only; neither label is evidence of a physical D1 database/schema/table.

## Decision 7 — W01 ENT-USER field source
ID: `CC-MAPPING-0-W01-ENT-USER-SOURCE-CONFLICT-2026-09-18`

Question:
A. promote the six canonical fields into active W01 Users implementation:
`username, displayName, bio, avatar, locale, timezone`;
or
B. formally reconcile the ENT-USER field contract/Blueprint to the intended W01 contract state.

No field copy and no contract rewrite is authorized before selection.

## Decision 8 — W01 Media collection entity authority
ID: `CC-MAPPING-0-W01-MEDIA-COLLECTION-ENTITY-AUTHORITY-GAP-2026-09-19`

Question: determine whether W01 `media` is:
A. an implementation of an existing canonical Entity not yet bound;
B. a Payload support collection that should remain non-domain with an explicit reconciliation exemption; or
C. another explicitly authorized canonical representation.

No ENT-MEDIA creation or unrelated Entity remap is authorized before selection.

## Decision submission format

Return the 8 decisions in one record:

1=<predicate/rule text>
2=<canonical entitlements path + operationId treatment>
3=A or B
4=<canonical AUTH-003 operationId set>
5=<canonical AUTH-006 DTO alias vocabulary + linked domain decision>
6=<D1-01 or D01 Core (or explicitly authorized equivalent)>
7=A or B
8=A or B or C

The selected decisions are the only missing authority inputs needed before deterministic reconciliation can begin. They do not themselves constitute implementation/runtime evidence.
