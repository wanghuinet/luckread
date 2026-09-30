# P0 — Actions Runtime Evidence Probe v1.0

## Purpose
Prevent static workflow validity from being mistaken for GitHub Actions Runtime Green.

## Required evidence
A reconciliation gate is Runtime Green only when all of the following are observable from GitHub Actions:

1. workflow run ID;
2. job ID;
3. checkout/setup/reconciliation/report-validation step results;
4. reconciliation report artifact;
5. report schema validation result;
6. final workflow conclusion.

## Fail-closed rule
Missing runtime evidence is not equivalent to success. `RUNTIME_GREEN=false` whenever the required evidence cannot be observed.

## Current blocker
The repository workflow is defined with `push`, `pull_request`, and `workflow_dispatch`, but the connected GitHub interface currently exposes no dispatch operation and no readable runtime run for the latest reconciliation commit.

## Manual execution procedure
When tool-based dispatch is unavailable:

1. Open GitHub → Actions → API Inventory Reconciliation.
2. Select `Run workflow`.
3. Select branch `main`.
4. Wait for the job to finish.
5. Verify the reconciliation job and report-validation step.
6. Verify artifact `api-inventory-reconciliation-evidence`.
7. Record the Run ID and final conclusion.

## Gate
Until these artifacts are available, API Inventory Reconciliation remains `NOT_GREEN` and downstream development admission remains blocked.
