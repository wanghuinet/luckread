# CC-AUTH-004-REMOTE-HTTP-EVIDENCE-HARNESS — 2026-09-28

Status: **EVIDENCE_HARNESS_ADMITTED / NOT_GREEN**

## Purpose

Provide the smallest controlled remote HTTP evidence channel for the already-admitted AUTH-004 W01 Payload-native adapters.

This change is **evidence tooling only**. It does not change Blueprint, API, DTO, field, migration, Worker topology, D1 topology, queue topology, cache topology, or Payload core.

## Authoritative inputs

- `contracts/api/AUTH-004-password-recovery-contract.v1.json`
- `contracts/api/auth-operation-policy.v1.json`
- `docs/change-control/CC-AUTH-004-PAYLOAD-NATIVE-ADAPTER-IMPLEMENTATION-ADMISSION-2026-09-28.md`
- Merged W01 implementation source SHA: `7e9396460136a6ce083db0f600ec04c7829a9c99`
- Existing W01 deployment workflow: `.github/workflows/w01-w02-binding-deploy.yml`

## Scope

The manual evidence workflow will:

1. require an explicit `RUN_AUTH004_REMOTE_E2E` confirmation;
2. require the exact W01 source SHA being tested;
3. resolve a successful existing W01/W02 deployment artifact for that exact source SHA instead of deploying anything;
4. exercise the three canonical public HTTP operations;
5. verify anonymous reset-request enumeration resistance;
6. verify password-change and password-reset session invalidation;
7. verify reset-token replay, expiry, and wrong-purpose rejection;
8. verify successful sensitive operations return no response body and do not expose the reset token;
9. record exact workflow/source/deployment provenance;
10. delete only the ephemeral test subject and related test-session/consent records after the run.

## Controlled remote D1 access

The evidence harness may read the native Payload reset token from the ephemeral test user's existing `users.reset_password_token` field only to exercise the already-contracted public reset-confirm route.

The raw token:

- is held only in process memory;
- is never written to an artifact;
- is never logged;
- is never placed in GitHub Actions outputs;
- is never added to the Evidence Registry;
- is deleted by the normal Payload reset flow and final cleanup.

The harness may temporarily move `reset_password_expiration` into the past for the ephemeral test subject solely to prove expiry rejection. No schema or production data is changed.

## Explicit non-goals

- No W01 deployment.
- No new Worker, D1, Queue, Cache, Saga, or Service Binding.
- No schema/migration changes.
- No product-code changes.
- No custom password/recovery source of truth.
- No promotion of AUTH-004, Evidence Registry, or Mapping 0 to GREEN.
- No lifecycle/event evidence claim; the current operation policy still records event evidence as MISSING.
- No modification of historical evidence.

## Gate result

A successful harness run means only that the executable remote HTTP/security assertions passed for the exact deployed source.

AUTH-004 remains **BLOCKED / NOT_GREEN** until lifecycle/event evidence, complete canonical traceability, Evidence Registry admission, and the separate Mapping 0 gate are satisfied.

## Backup

Pre-change backup:

`backup/main-before-auth004-remote-evidence-harness-20260928`