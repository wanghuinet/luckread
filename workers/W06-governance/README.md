# W06 — Rights / Trust & Safety / Governance

Canonical Worker identity: **W06**  
Canonical responsibility: **Rights / Trust & Safety / Governance**  
Primary D1: **D1-03**

This directory is the canonical source-implementation boundary for the frozen W06 Worker.

Important governance constraints:

- Worker authority comes from the canonical Worker Master, not from directory names.
- The existing `workers/W06-media` directory is a historical/physical-layout mismatch and is not promoted as W06 authority.
- W09 is the frozen D1-03 primary owner for AuditEvent. W06 retains the existing Cloudflare D1 compatibility write path only until a separate runtime-adapter slice moves publication/persistence to the W09 owner boundary.
- AUTH-013 source implementation may consume W02 transition results but may not take ownership of D1-01 account-state mutation.
- No ad-hoc AuditEvent table may be created in W02.
- Physical Cloudflare Worker name and D1-03 UUID are not yet admitted in the current repository; deployment remains blocked until explicit physical-binding evidence exists.

Current source slice:

- canonical immutable AuditEvent construction and legacy Cloudflare D1 compatibility persistence;
- AUTH-013 `identity.account_state_changed` audit record construction;
- strict version-increment validation.

No remote D1 mutation or production deployment is implied by this source directory.
