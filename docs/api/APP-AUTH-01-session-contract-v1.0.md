# APP-AUTH-01 — Login and Session Public Wire Contract v1.0

- Status: `CONTRACT_FROZEN_RUNTIME_VERIFICATION_PENDING`
- Scope: public login, current-session validation, and logout only.
- Identity/session authority: W02 / Better Auth.
- Public API boundary: W01.
- No new Worker, D1, Queue, Payload Core extension, or independent session store is introduced.
- This contract does not close or implement the separate L1→L2 role grant or true refresh-token rotation.

## 1. One session, two transport carriers

LuckRead uses one W02/Better Auth session. It is not a separate access-token + refresh-token pair.

- Browser: retain the `HttpOnly` cookie emitted by `Set-Cookie` in a cookie jar. Do not read, manually parse, or construct the session cookie from application code.
- Native APP: read `X-LuckRead-Session-Token` from a successful login response and store it only in platform secure storage (iOS Keychain / Android Keystore-backed storage). Send `Authorization: Bearer <session-token>` on subsequent requests.
- Both carriers authenticate the same session ID and have the same expiration/revocation semantics.
- Login JSON contains a stable public user DTO only. The session credential is excluded from JSON bodies and response evidence.
- There is no public `accessToken` / `refreshToken` pair and no rotating refresh credential in this contract.

The public response header is owned by W01. W01 adapts Better Auth's current `set-auth-token` header so public clients are not coupled to the upstream header name.

## 2. Login

### Request

`POST /api/v1/auth/login`

```http
POST /api/v1/auth/login HTTP/1.1
Content-Type: application/json
Accept: application/json
```

```json
{
  "identity": "reader@example.com",
  "credential": "<password>"
}
```

Required fields: `identity` (valid email address) and `credential` (non-empty password). Unknown fields are not used. `deviceId` is not part of this route's wire contract and must not be sent as a substitute session authority.

### Success

HTTP `200`, `Cache-Control: no-store`.

Response headers include:

- `Set-Cookie`: browser session cookie, when emitted by W02.
- `X-LuckRead-Session-Token`: opaque session credential for native clients.

Response body:

```json
{
  "data": {
    "user": {
      "id": "user-id",
      "email": "reader@example.com",
      "name": "Reader",
      "emailVerified": true,
      "image": null
    }
  },
  "requestId": "request-correlation-id"
}
```

The opaque token is not included in the body. User identifiers and the request ID above are illustrative.

### Errors

- `400`: malformed JSON, invalid email, or missing required input. W01 returns the canonical `error + requestId` envelope.
- `401 UNAUTHENTICATED`: invalid email/password; response does not disclose whether an account exists.
- `403 EMAIL_NOT_VERIFIED`: email verification must be completed before sign-in.
- `429 RATE_LIMITED`: auth rate limit reached.
- `503 SERVICE_UNAVAILABLE`: auth authority unavailable.
- Any upstream 2xx response missing the expected user/session credential is rejected as `502 AUTH_UPSTREAM_RESPONSE_INVALID`; W01 does not invent a session token.

## 3. Read current session

### Request

`GET /api/v1/auth/session`

Send either the browser cookie or `Authorization: Bearer <session-token>`. Use only one canonical carrier per request.

### Success

HTTP `200`, `Cache-Control: no-store`.

```json
{
  "data": {
    "session": {
      "id": "session-id",
      "expiresAt": "2026-10-18T12:00:00.000Z"
    },
    "user": {
      "id": "user-id",
      "email": "reader@example.com",
      "name": "Reader",
      "emailVerified": true,
      "image": null
    }
  },
  "requestId": "request-correlation-id"
}
```

Only the public session fields `id` and `expiresAt` are exposed. Internal/raw session tokens are stripped. If W02 emits an updated session credential header, W01 normalizes it to `X-LuckRead-Session-Token`.

No valid session returns HTTP `401 UNAUTHENTICATED`. A session read response is never shared-cached.

## 4. Logout

`POST /api/v1/auth/logout`

Send the current cookie or Bearer session token. Success returns HTTP `204` with no body. Cookie clients receive the session cookie clearing response where applicable. W01 never echoes the revoked session token. The old credential must fail subsequent session validation regardless of which transport carrier is used.

## 5. Legacy refresh path

`POST /api/v1/auth/refresh` is deprecated and is retained temporarily as a compatibility alias for current-session lookup only. It does **not** rotate refresh tokens and must not be used as the native APP refresh contract. New clients use `GET /api/v1/auth/session`.

True refresh-token rotation, expiry/reuse detection, and rotation lineage remain outside this contract and are not claimed as implemented. They require their own accepted operation and runtime evidence before any client should depend on them.

## 6. Real runtime acceptance

Manual workflow: [APP Auth Session Live E2E](../../.github/workflows/app-auth-session-live-e2e.yml)

It uses an existing, registered, email-verified QA account to test the following sequence against `https://luckread.com`:

1. successful login returns HTTP 200, the stable user DTO, `Set-Cookie`, and `X-LuckRead-Session-Token`;
2. the session credential is absent from JSON;
3. the same session can be read with the cookie and with Bearer authorization;
4. the protected current-profile API accepts the same cookie and Bearer session;
5. logout returns 204 and clears the cookie where present;
6. the revoked session is rejected with 401 for both old cookie and old Bearer credential.

The artifact records only status codes, response top-level keys, Cloudflare Ray IDs, cookie *names*, durations, and boolean comparisons made in memory. It does not store credentials, session tokens, cookie values, raw response bodies, email, or user/session IDs.

Required GitHub Actions repository secrets (never paste the password into chat or source code):

- `LUCKREAD_APP_AUTH_SMOKE_EMAIL`: an existing QA account that has completed email verification.
- `LUCKREAD_APP_AUTH_SMOKE_PASSWORD`: that QA account's password.

The workflow must be run only after this revision has been deployed to the tested production target. Until that run passes, APP-AUTH-01 remains **runtime-verification-pending**; passing static contract tests does not constitute live acceptance.
