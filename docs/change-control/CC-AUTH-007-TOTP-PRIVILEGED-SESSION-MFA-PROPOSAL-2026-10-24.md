# CC-AUTH-007-TOTP-PRIVILEGED-SESSION-MFA-PROPOSAL-2026-10-24

- Status: PROPOSED / NOT ADMITTED
- Implementation status: draft branch only; not merged, not deployed, no production migration applied.
- Canonical blocker: `contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md` remains `BLOCKED_NOT_GREEN` with implementation authorization `false`.
- Scope: candidate TOTP enrollment/challenge/verification implementation needed before any L5-L8 session can exercise privileged authority.

## Proposed behavior

1. W02 remains the identity, session, role-assignment and MFA assurance authority. W01 remains the public boundary and forwards through the existing `W02_AUTH` Service Binding.
2. Reuse the repository-pinned Better Auth `1.7.8` two-factor plugin. Any authenticated ACTIVE account may voluntarily enroll MFA. Enrollment does not grant a role; W02 resolves authority solely from persisted `role_assignments`, never a body field or client layer claim. L5-L8 privileged access still requires authoritative verified MFA and session assurance.
3. Use TOTP with the provider's verified-enrollment flow and one-time recovery codes. Do not enable trust-device bypass for privileged login. Keep challenge lifetime, attempt caps and account lockout enabled at the provider's configured defaults until a canonical security contract fixes them.
4. Record the activation timestamp in W02/D1-01 when the factor becomes enabled. A pre-enrollment session cannot gain privileged access merely because another session enrolled MFA.
5. When the highest persisted role maps to L5-L8 and the current session does not prove verified MFA established no later than session creation, W02 excludes all L5-L8 assignments from the principal response and resolves the highest remaining effective global assignment below L5. It never edits the authoritative RoleAssignment rows as a side effect of MFA enforcement.
6. W01 converts Better Auth's second-factor challenge into an application-owned DTO. Successful TOTP/backup-code verification responses must not echo the raw session token in JSON; the canonical bearer credential is surfaced only through `X-LuckRead-Session-Token`, and browser cookie delivery remains HttpOnly.
7. TOTP setup is exposed only after W02 validates an authenticated ACTIVE session. The first L8 target must be able to enroll and verify TOTP before the initial RoleAssignment exists; the genesis grant separately requires verified MFA. Requiring an existing L5-L8 assignment for enrollment would make first bootstrap impossible.

## Proposed D1 change

A draft W02 migration adds:
- `user.two_factor_enabled` and the MFA activation timestamp;
- Better Auth's canonical `twoFactor` model with TOTP secret, encrypted backup codes, verified status, failed-verification count and lockout deadline;
- a database trigger that stamps the activation timestamp on the transition from disabled to enabled.

The migration is source-only on a draft branch. It has not been applied to any D1 database.

## Required negative and integration evidence before admission

- correct Better Auth 1.7.8 schema introspection using the exact W02 D1 schema;
- enrollment requires the target's existing password and a valid ACTIVE session; self-service enrollment is not a role grant and cannot create privileged authority;
- challenge has no authenticated session until a correct second factor is verified;
- invalid, expired, replayed, or over-attempt challenge fails closed;
- backup code is single-use and cannot be reused;
- trusted-device cookies do not bypass privileged MFA;
- old pre-enrollment sessions cannot retain L5-L8 authorization after MFA is enabled;
- successful verification rotates the current session and never returns a raw session credential in JSON;
- W01/W02 integration tests cover both browser cookie and native Bearer carriers;
- the canonical MFA API/DTO/entity/field/event/security contracts and evidence registry are updated and approved.

## Explicit non-claims

This proposal does not set AUTH-007 to GREEN. It does not authorize deployment, schema migration, or first-L8 role assignment. All new code must remain unmerged until the canonical AUTH-007 contract and its security tests are admitted. The first L8 still requires the separately reviewed genesis-bootstrap approval path; MFA enrollment does not create or elevate a role.
