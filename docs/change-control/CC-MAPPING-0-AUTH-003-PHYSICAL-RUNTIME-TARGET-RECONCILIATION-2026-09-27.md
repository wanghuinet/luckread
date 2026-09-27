# Change Control — AUTH-003 Physical Runtime Target Reconciliation
## 2026-09-27

- Control ID: `CC-MAPPING-0-AUTH-003-PHYSICAL-RUNTIME-TARGET-RECONCILIATION-2026-09-27`
- Status: `PHYSICAL_TARGET_AUTHORITY_CLOSED / CURRENT-SHA-EVIDENCE_SEPARATE`
- Source main: `1fec1cebb79243baba9f22e59e715b5e3335fabc`
- Backup: `backup/pre-auth003-physical-identity-reconcile-20260927`
- Machine artifact: `artifacts/mapping-0/auth-003-physical-runtime-target-reconciliation-2026-09-27.json`

## Closed authority

The AUTH-003 logical and physical target identity is now explicit:

`AUTH-003 → W02 → luckread-w02 → D1-01 → luckread (2f80471e-3756-49f9-8db1-7707a433ad64)`

The source path is `workers/W02-content`, and the current committed `workers/W02-content/wrangler.jsonc` binds `D1_01` to the same database name/UUID.

The W02 deployment decision explicitly names `luckread-w02`. The controlled W02 deployment and W01 `W02_AUTH` service-binding evidence are already verified at runtime scope under runs `35816952574` and `35819898556`.

## Evidence boundary retained

The above closes **target identity authority**, not AUTH-003 runtime correctness.

The existing deployment evidence uses an earlier admitted W02 source commit. AUTH-003 implementation must still bind all runtime evidence to one exact tested commit SHA. No runtime correctness is inherited from the existence of `luckread-w02`.

Likewise, the D1 target identity is closed, but the AUTH-003 physical schema is not:

- table names = `PENDING_SCHEMA_EVIDENCE`
- columns = `PENDING_FIELD_BY_FIELD_SCHEMA_EVIDENCE`
- indexes = `PENDING_SCHEMA_EVIDENCE`
- constraints = `PENDING_SCHEMA_EVIDENCE`
- migration execution = `NOT_EXECUTED`

## Result

- Logical Worker authority: **CLOSED — W02**
- Logical D1 authority: **CLOSED — D1-01**
- Physical Worker target name/source: **CLOSED — luckread-w02 / workers/W02-content**
- Physical D1 target identity: **CLOSED — luckread / 2f80471e-...**
- Current-SHA AUTH-003 deployment evidence: **REQUIRED**
- AUTH-003 schema/migration evidence: **REQUIRED**
- Operation-policy resource/cache/retry/event/queue/anti-abuse authority: **STILL BLOCKED**
- Runtime implementation admission: **NOT AUTHORIZED**

This control does not create or rename a Worker, create a D1, execute a migration, change API/DTO contracts, or promote entities.
