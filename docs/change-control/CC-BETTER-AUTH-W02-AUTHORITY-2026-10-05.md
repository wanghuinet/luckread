# CC-BETTER-AUTH-W02-AUTHORITY-2026-10-05

Status: IMPLEMENTATION / RUNTIME RECONCILIATION REQUIRED

Better Auth 1.7.7 is formally owned by W02 / D1-01 as the sole authentication authority.

W01 remains the public API / Payload boundary. Public authentication requests use the existing W01 -> W02_AUTH Service Binding.

W02 / Better Auth owns registration, credentials, login, sessions, logout/revocation, password change and recovery. W02 Account State and AuthZ remain separate decisions over the authenticated principal.

W01 owns public request validation, edge anti-abuse/rate limits, Payload/CMS documents and compatibility adapters. W01 must not contain a second credential or session authority.

No additional Worker, D1, Queue or binding is introduced.

Legacy users.hash/users.salt are migration-compatibility data only.

The historical Payload-native AUTH-002 session-extension authority is superseded for the current authentication model. Historical contracts/evidence remain preserved for audit and must not be reused as current GREEN evidence.

Promotion requires exact-SHA W02 build/deployment evidence, cross-worker runtime evidence, controlled D1-01 migration evidence, Contract/Evidence Registry reconciliation and Mapping-0 revalidation. This change is not GREEN merely because the source moved.
