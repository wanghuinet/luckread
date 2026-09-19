# CC-MAPPING-0-CODE-EVIDENCE-FIELD-IMPLEMENTATION-STATUS-2026-09-19

## Status

OPEN

## Scope

Correct the code-evidence inventory generator so a canonical field marked `VERIFIED` is not automatically promoted to `implementationStatus=IMPLEMENTED` when its `sourceRef` is not an existing active repository path.

## Observed defect

`scripts/build-code-evidence-inventory.mjs` currently applies:

```text
field.status === 'VERIFIED' ? 'IMPLEMENTED' : 'UNRESOLVED'
```

without validating that `field.sourceRef` resolves to an active source file.

At the current main revision, the six ENT-USER field records therefore become `IMPLEMENTED` while their sourceRef remains the historical root path `src/collections/Users.ts`. The declared active Payload authority is `workers/W01-payload/`, and the historical root is archived.

## Authority constraints

- This is an evidence/tooling correction only.
- It MUST NOT add or remove ENT-USER fields.
- It MUST NOT change ENT-USER field contract status.
- It MUST NOT copy historical fields into W01.
- It MUST NOT promote Mapping 0 status.
- It MUST NOT treat generated migration or local evidence as current remote-D1 evidence.
- Existing business/domain contracts remain authoritative and unchanged.

## Approved deterministic rule

For FIELD evidence:

1. A field may be classified `IMPLEMENTED` only when its `sourceRef` resolves to an existing active repository path and the referenced path is not under `archive/`.
2. Otherwise the record MUST be `UNRESOLVED`, with no implementation/schema evidence promoted from that stale or missing source.
3. The generator remains fail-closed; no inference from field contract status alone.

## Expected affected records

Exactly the six current ENT-USER field evidence records whose sourceRef is `src/collections/Users.ts`:

- ENT-USER-F-USERNAME
- ENT-USER-F-DISPLAY-NAME
- ENT-USER-F-BIO
- ENT-USER-F-AVATAR
- ENT-USER-F-LOCALE
- ENT-USER-F-TIMEZONE

## Validation

After the generator change, regenerate `contracts/alignment/code-evidence-inventory.v1.json` and verify:

- the six stale FIELD records are `UNRESOLVED`;
- active-source FIELD records, when present, retain their normal implementation status;
- no entity, Payload collection, API operation, or canonical Mapping status is changed by the correction;
- Mapping 0 structural gate remains independently evaluated;
- the known W01 ENT-USER and Media authority controls remain open.

## Closure criterion

Close this control only after the generator and generated artifact agree with the rule above and the resulting repository state is re-observed from the new commit.
