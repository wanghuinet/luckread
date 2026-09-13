# LuckRead Contract-First Platform

LuckRead uses a contract-first development model. Product architecture, machine-readable contracts, validation rules, API/state/authz contracts, and CI evidence are the source of truth for implementation.

## Repository baseline

The `main` branch intentionally does not contain a Payload application implementation during contract admission. This prevents framework-template code from being mistaken for a compliant product implementation and keeps the admission result focused on the contracts themselves.

The repository retains:

- `contracts/` — machine-readable contracts
- `docs/` — product, architecture, API, authorization, state-machine, security, reliability, and governance specifications
- `scripts/` — dependency-free contract validation and semantic cross-contract validation
- `.github/workflows/contract-ci.yml` — contract CI gate
- `.github/workflows/actions-execution-probe.yml` — hosted-runner execution probe
- `.agents/skills/payload/` — Payload development reference material, not product implementation

## Development rule

Payload is restored only after the contract/evidence admission gates are green. At implementation time, the project must pull the approved/pinned upstream Payload version and then implement against the already-frozen contracts.

The direction is:

```text
Product Requirements
        ↓
Canonical Contracts
        ↓
Machine-readable Contracts
        ↓
Semantic Cross-Contract Validation
        ↓
GitHub Actions Execution Evidence
        ↓
Development Admission GREEN
        ↓
Pull approved Payload version
        ↓
Implement against frozen contracts
        ↓
Runtime / Security / Integration Evidence
```

Implementation must not redefine the contract. A framework default, generated type, collection schema, or framework API is not authoritative unless it is explicitly mapped to the canonical contract.

## Current status

The repository is in contract-admission hardening. Payload implementation is intentionally absent until the admission gate is closed with current-SHA execution evidence.

A hosted-runner execution blocker is tracked separately in GitHub Issue #2. Local structural and semantic validation does not override a failed or unexecuted hosted CI gate.
