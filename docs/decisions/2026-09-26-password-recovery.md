# Password recovery wire decision

Decision status: authoritative engineering decision.

Canonical operations remain unchanged. Password change uses currentPassword/newPassword and 204 without body. Reset request uses identifier and 202 without body, with account-enumeration-resistant uniform public semantics. Reset confirm uses recoveryToken/newPassword and 204 without body. All three use NO_STORE. Idempotency-Key is required only for password change; reset request and reset confirm use their dedicated anti-abuse and single-use recovery boundaries instead. Password policy is 15..128 Unicode code points, Unicode and spaces allowed, no composition-class requirement, compromised-password screening required, no silent truncation. Persistence-only recovery identifiers, hashes, timestamps, delivery metadata, session secrets and password material are never public.

Operation policy: password change and reset confirm are SINGLE_AUTHORITATIVE_WRITE; reset request is BOUNDED_COMPOSITION. Each permits at most 2 D1 reads and 2 D1 writes; row caps are 8/64 for the credential mutations and 8/4 for reset request. Shared cache is forbidden. Recovery delivery remains asynchronous.

This record resolves the authority gap and authorizes contract reconciliation only. It does not mark runtime or evidence GREEN.
