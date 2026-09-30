# AUTH-013 W06 Deployment Admission Base — 2026-09-24

- Decision ID: `CC-MAPPING-0-AUTH-013-W06-DEPLOYMENT-ADMISSION-BASE-2026-09-24`
- Scope: Contract-first admission provenance for the controlled W06 deployment shell
- Repository authority: GitHub `main`

## 1. Contract admission baseline

Contract CI Run **35957666015** tested head:

`367534dc07806a9b9f9a1b85ae8ecf42a7ae4afc`

The overall workflow conclusion was FAILURE, but the failure was limited to the downstream Five-Way Alignment and Strict Downstream R4/Evidence/R5 gates.

The following core Contract gates were all SUCCESS:

- Blueprint Feature Inventory Gate
- Contract Admission Gate (state-machines)
- Contract Admission Gate (openapi)
- Mapping 0 Structural/Contract Gate
- Contract Admission Gate (authz)
- Contract Admission Gate (common)
- Semantic Cross-Contract Gate
- Payload Contract Reconciliation Gate
- Contract Admission Gate (enums)
- Capability Contract Graph Gate

This is consistent with the existing Mapping 0 stage-separation rule: the downstream alignment/evidence failures do not invalidate the core Contract admission baseline.

## 2. Source delta inheritance

The W06 deployment source candidate `eb9f33dda3e9892f1814d34bbe4c8327a1ba2dde` is a descendant of the Contract admission base and changes only the W06 execution/evidence boundary:

- `workers/W06-governance/**`
- `.github/workflows/w06-*`

No Contract, Blueprint, Entity/Field authority, Worker Master, D1 Master, or canonical API schema input was changed in this delta.

Therefore the core Contract admission evidence from Run `35957666015` is inherited for the W06 controlled deployment shell.

## 3. Exact W06 source candidate evidence

At source head `eb9f33dda3e9892f1814d34bbe4c8327a1ba2dde`:

- Mapping 0 Structural Gate Run `35958357483` = SUCCESS
- Feature Inventory Run `35958357443` = SUCCESS
- AUTH-013 Persistence Schema Evidence Run `35958357450` = SUCCESS
- W06 Audit Event Source CI Run `35958357489` = SUCCESS
  - W06 source TypeScript = SUCCESS
  - W06 runtime shell TypeScript = SUCCESS
  - W06 AuditEvent tests = SUCCESS

## 4. Deployment admission disposition

The W06 deployment shell is **ADMITTED FOR CONTROLLED MANUAL EXECUTION** at source SHA:

`eb9f33dda3e9892f1814d34bbe4c8327a1ba2dde`

The deployment workflow additionally verifies the inherited Contract core gate baseline and rejects any later source SHA that changes authority-sensitive paths outside the admitted W06 delta.

This admission does not authorize D1-03 schema migration or AuditEvent persistence.

## 5. Next evidence

Manual controlled deployment must produce:

1. Worker creation/version identity for `luckread-w06`;
2. exact runtime binding to D1-03 UUID `bda1d247-a371-4244-91ae-aef96034db7f`;
3. deployment success;
4. `/health` smoke evidence;
5. only then, D1-03 AuditEvent schema/migration admission.

Manual workflow:
https://github.com/wanghuinet/luckread/actions/workflows/w06-deploy.yml
