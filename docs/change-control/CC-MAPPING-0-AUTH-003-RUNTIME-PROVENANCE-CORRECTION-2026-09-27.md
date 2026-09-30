# Change Control: AUTH-003 Runtime Evidence Provenance Correction — 2026-09-27

- Current main before correction: `7f0bab266fcea439941274ab97a2ea53cc6a3596`.
- Backup branch: `backup/pre-auth003-runtime-provenance-correction-20260927`.
- Correction branch: `fix/auth003-runtime-provenance-correction-20260927`.

The controlled runtime evidence run `36299334577` tested exact implementation source `419bb7fd887af0c30412bead50f8196ec6446bb7`. The prior admission commit accidentally copied the subsequent current-main SHA `7f0bab266fcea439941274ab97a2ea53cc6a3596` into the runtimeEvidence.sourceSha metadata field.

This correction changes only provenance metadata in the cursor and AUTH-003 admission packet. It does not modify code, evidence result, artifact, remote D1 state, or runtime behavior.

No runtime rerun is required because the actual GitHub Actions artifact and logs already bind the PASS to `419bb7fd...`.
