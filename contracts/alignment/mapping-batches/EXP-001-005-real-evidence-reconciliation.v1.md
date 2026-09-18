# EXP-001..EXP-005 Real-Evidence Reconciliation v1

Status: `BLOCKED_NOT_GREEN`
Implementation authorization: `false`
Mapping mode: `Evidence-bound only; fail-closed`
Canonical source of truth: `docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md`
Canonical feature inventory: `contracts/alignment/feature-inventory.v1.json`

## 1. Scope

- EXP-001 experiment
- EXP-002 audience/variant
- EXP-003 allocation/rollout
- EXP-004 experiment metrics
- EXP-005 rollback

## 2. Authoritative evidence found

- `docs/69-ANALYTICS-EXPERIMENT-GROWTH-CONTRACT-v1.0.md` — canonical experiment, audience/variant, allocation/rollout, experiment metrics and rollback semantics for the analytics/experiment/growth domain.

This is an authoritative experiment contract, not executable experimentation runtime.

## 3. Common closure gaps (apply to all records)

- canonical experiment/variant/audience entity, fields and DTO;
- allocation/rollout engine semantics (deterministic assignment, consistency);
- experiment metric definition and statistical analysis authority;
- rollback/kill-switch runtime;
- guardrail and AA/A-B test hygiene;
- Payload / Worker code owner, executable tests and Evidence Registry provenance.

## 4. Feature notes

- EXP-001 experiment — `BLOCKED_NOT_GREEN`: see `docs/69`; no experiment registry runtime.
- EXP-002 audience/variant — `BLOCKED_NOT_GREEN`: see `docs/69`; no audience/variant binding runtime.
- EXP-003 allocation/rollout — `BLOCKED_NOT_GREEN`: see `docs/69`; no assignment engine runtime.
- EXP-004 experiment metrics — `BLOCKED_NOT_GREEN`: see `docs/69`; no metric pipeline evidence.
- EXP-005 rollback — `BLOCKED_NOT_GREEN`: see `docs/69`; no kill-switch runtime evidence.

## 5. Admission decision

`EXP-001..EXP-005 = BLOCKED_NOT_GREEN`

No experimentation runtime implementation is authorized by this batch. Contract/design evidence exists; executable evidence is not closed.