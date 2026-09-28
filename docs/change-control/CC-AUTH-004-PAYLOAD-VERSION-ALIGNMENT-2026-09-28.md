# CC-AUTH-004-PAYLOAD-VERSION-ALIGNMENT — 2026-09-28

Status: GAP_CONFIRMED / VERSION_ALIGNMENT_REQUIRED

## Trigger

The AUTH-004 executable local probe on the current W01 dependency baseline (Payload 3.87.1) established that a successful password update did not invalidate any previously-issued native sessions.

The probe failed with the concrete invariant: native password change did not revoke any prior native session.

No custom session state was added and no production session schema was changed.

## External capability check

Current Payload documentation states that with sessions enabled, an authenticated password update keeps the current session and ends the user's other sessions. Payload's release notes identify this behavior as part of the security fixes shipped in 3.90.0.

W01 is currently pinned to Payload 3.87.1. Therefore the implementation contract is stricter than the pinned dependency capability.

## Decision

Move the W01 Payload package family from 3.87.1 to 3.90.2, the latest stable Payload 3.x release available at this Change Control checkpoint.

Upgrade scope is limited to the existing Payload family:

- payload
- @payloadcms/db-d1-sqlite
- @payloadcms/next
- @payloadcms/richtext-lexical
- @payloadcms/storage-r2
- @payloadcms/ui

No new authentication subsystem, session table, token store, Worker, D1 database, queue, or Payload core fork is introduced.

## Constraints

- Keep W01 as the sole Payload authority.
- Keep AUTH-004 public adapters unchanged unless compatibility validation proves a concrete regression.
- Keep removeTokenFromResponses=true.
- No custom session invalidation implementation.
- No AUTH-004 migration.
- Re-run the existing local AUTH-004 lifecycle probe only after dependency alignment.
- Do not promote Evidence Registry or Mapping 0 based on build success alone.
- Remote W01 / HTTP E2E remains a separate evidence gate.

## Acceptance

Version alignment is accepted only when:

1. dependency lock is internally consistent;
2. Payload foundation/admission CI passes;
3. AUTH-004 local session lifecycle probe proves:
   - current session remains valid after password change;
   - another existing session is invalidated;
   - reset invalidates pre-reset sessions;
   - reset token remains single-use and expiry-bound;
4. no secret material appears in evidence output.

Until those conditions are met, AUTH-004 remains BLOCKED / NOT_GREEN.

## Backup

backup/main-before-auth004-payload-version-alignment-20260928

## 2026-09-28 Execution checkpoint

The pre-upgrade Payload 3.87.1 schema snapshot was generated successfully in controlled CI run `36410882875` and is now queued for authoritative W01 migration-baseline restoration. The snapshot itself is not runtime evidence and will not be admitted as GREEN.

## 2026-09-28 Migration diff checkpoint

With the authoritative pre-upgrade snapshot now committed, the next executable gate is a Payload 3.90.2 native migration diff review. No migration application or GREEN admission is implied by generation.

## 2026-09-28 Native schema execution checkpoint

Payload 3.90.2 CLI review identified exactly two native schema deltas relative to the verified 3.87.1 baseline snapshot: `users.reset_password_requested_at` and `media._objectkey`. The approved path is to admit only these CLI-generated changes as the Payload native schema alignment migration; no custom AUTH-004 persistence is introduced.

## 2026-09-28 Exact SQL delta checkpoint

The executable gate now validates the Payload-generated migration directly: exactly four ALTER statements (two UP + two DOWN), no CREATE/DROP TABLE or index changes, required native snapshot fields, and the migration index entry. Historical JSON snapshot gaps are treated as migration-tool provenance, not as application schema deltas.

## 2026-09-28 Fixed-string gate checkpoint

Migration SQL/JSON diagnostics passed in isolation; the prior CI failure was only shell regex handling of escaped backticks. The gate now uses fixed-string matching with the same exact SQL requirements.
