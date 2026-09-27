# Change Control: AUTH-004 Local Probe Response Boundary — 2026-09-27

- Change Control ID: `CC-MAPPING-0-AUTH-004-LOCAL-PROBE-RESPONSE-BOUNDARY-2026-09-27`
- Status: `EVIDENCE-HARNESS-CORRECTION / NOT_GREEN`
- Feature: `AUTH-004`
- Base commit: `39ce7cb09b982c1cb634ecd5788247950e262d8f`
- Backup: `backup/pre-auth004-local-probe-boundary-record-20260927`

The AUTH-004 local evidence harness was corrected to respect the existing W01 Payload authentication response boundary.

The probe now verifies:
- native Payload login succeeds;
- the old password is rejected after password change;
- the changed password is accepted;
- native forgot-password/reset-password works;
- reset-token replay is rejected;
- expired reset-token use is rejected;
- secrets are not emitted into the evidence result.

Existing-session revocation after password change is explicitly `NOT_TESTED` by this probe because the production collection intentionally uses `removeTokenFromResponses=true`, and the evidence harness does not weaken that boundary or extract/reuse authentication credentials outside the existing W01 runtime path.

No W02 recovery subsystem, custom credential persistence, remote D1 access, Payload Core modification, or Evidence Registry PASS/VERIFIED claim is added.

Latest local evidence execution is tracked separately by workflow run `36287402216`; its final result must be admitted only from the completed workflow output.
