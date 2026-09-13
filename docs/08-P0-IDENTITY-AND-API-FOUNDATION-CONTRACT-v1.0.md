# P0 Identity and API Foundation Contract v1.0

**Status:** READY FOR IMPLEMENTATION

**Scope:** User identity/account foundation only. This contract does not implement creator, social graph, feed, recommendation, commerce or other downstream domains.

## 1. Goal

Establish one authoritative identity model that every future API/domain can reference without redefining account, role, status, privacy or audit semantics.

## 2. User authoritative fields

| Field | Type | Required | Authority | Rule |
|---|---|---:|---|---|
| id | Payload ID | yes | Payload/D1 | immutable |
| email | auth email | yes | Payload/D1 | unique, authentication identity |
| username | string | yes | Payload/D1 | unique, 3-32 chars |
| displayName | string | no | Payload/D1 | presentation only |
| bio | text | no | Payload/D1 | presentation only |
| role | enum | yes | Payload/D1 | user/admin for v1 |
| status | enum | yes | Payload/D1 | active/suspended |
| verified | auth verification state | yes | Payload auth; never generic profile-editable |
| locale | string | no | Payload/D1 | user preference |
| timezone | string | no | Payload/D1 | user preference |
| marketingConsent | boolean | yes | Payload/D1 | default false |
| createdAt | timestamp | yes | Payload/D1 | immutable audit field |
| updatedAt | timestamp | yes | Payload/D1 | managed by Payload |

## 3. Access rules

- Anonymous users may register only through the public registration path.
- Authenticated users may read/update their own profile fields allowed by policy.
- Only admins may change `role` and `status`.
- `verified` is never user-editable through a generic profile update.
- Suspended users cannot perform protected business mutations.
- No future domain may invent an independent user identifier.

## 4. Registration UX contract

LuckRead registration should **borrow proven interaction patterns from mainstream short-video/social platforms such as TikTok**, while maintaining LuckRead's own visual identity, copy, assets and interaction details. This is behavioral/UX reference, not a visual or brand copy requirement.

### 4.1 Registration principles

- Minimize initial input and cognitive load.
- Prefer a short, step-by-step flow over one large registration form.
- Keep registration and login paths easy to switch between.
- Validate each step before advancing.
- Preserve entered state when a recoverable error occurs.
- Make security, privacy and consent understandable without blocking the user with unnecessary fields.
- Do not require creator, MCN, IP, social or other downstream information during basic account registration.
- Registration completion should transition directly into the product onboarding/content experience.

### 4.2 P0 registration journey

```text
Register
  ↓
Choose Phone / Email
  ↓
Verification Code
  ↓
Set Password
  ↓
Choose Username
  ↓
Age / Birth Date Confirmation
  ↓
Terms / Privacy Consent
  ↓
Interest Selection (optional / skippable where policy permits)
  ↓
Registration Complete
  ↓
Home / Onboarding
```

The implementation may combine or split screens where usability testing demonstrates a better result, but the logical contract and security checkpoints must remain intact.

### 4.3 Entry screen

The entry screen must provide:

- Register
- Login
- Phone registration
- Email registration
- Supported third-party identity providers when enabled by a separate authentication contract

The page must not expose administrative, creator, MCN or internal system controls.

### 4.4 Phone / email verification

Requirements:

- User chooses phone or email where both are enabled.
- Verification code has an expiration window.
- Resend is rate-limited.
- Repeated failures trigger risk controls/challenge where required.
- Verification success is server-authoritative.
- Error messages must not unnecessarily disclose whether another account exists.

### 4.5 Password

Requirements:

- Server-side password policy validation.
- Never log or expose plaintext passwords.
- Password creation must be protected against abuse/rate attacks.
- Password strength feedback must not reveal security policy internals.
- Password recovery is a separate authenticated recovery flow.

### 4.6 Username

Requirements:

- Unique username.
- 3-32 character contract from the identity model.
- Normalize and validate according to the username policy.
- Availability check must not become an account-enumeration oracle.
- Reserved/system names must be rejected.
- Username creation must be authoritative and race-safe.

### 4.7 Age / birth-date confirmation

Registration must establish the minimum age information required by applicable product policy and jurisdictional requirements.

Rules:

- Do not collect unnecessary personal information.
- Age eligibility must be evaluated server-side.
- Age-restricted experiences must be enforced after registration as well as during registration.
- Exact birth date must not be exposed to unrelated domains unless explicitly authorized.

### 4.8 Terms / privacy / consent

The registration flow must clearly identify:

- Terms of Service
- Privacy Policy
- Marketing consent where applicable
- Required versus optional consent

Marketing consent defaults to `false` and must not be bundled invisibly into required acceptance.

### 4.9 Interest onboarding

Interest selection may be shown immediately after registration to improve initial content discovery.

It must be:

- optional/skippable where product policy permits;
- editable later;
- treated as a preference signal rather than authoritative user identity;
- isolated from authentication/account authority.

### 4.10 Completion

After successful registration:

```text
Account Created
→ Initial Profile Ready
→ Security / Session Established
→ Optional Interest Profile
→ Home / Onboarding
```

The user should not be forced through creator, monetization, MCN or other advanced setup before reaching the core product.

## 5. Registration failure and recovery UX

The UI must define explicit states for:

- invalid verification code
- expired verification code
- resend cooldown
- password validation failure
- username unavailable
- username policy violation
- age ineligible
- consent missing
- risk challenge required
- rate limit
- network failure
- server failure
- registration retry

General rule:

```text
Failure
→ Explain actionable state
→ Preserve safe input
→ Retry / Recover
→ Continue original journey
```

Do not silently discard valid previously entered information.

## 6. API boundary

The future APP API must expose a stable DTO rather than Payload's internal User document.

Required foundation endpoints/contracts:

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/me`
- `PATCH /v1/me`

Registration may be implemented as a multi-step API flow internally, but the public contract must remain versioned and stable.

Exact transport implementation may use Payload auth internally, but Payload internals are not part of the public contract.

## 7. Profile update boundary

User-editable profile fields for v1:

- username (subject to uniqueness/policy)
- displayName
- bio
- locale
- timezone
- marketingConsent

Admin-only:

- role
- status

System-only:

- verified
- timestamps

## 8. Future IAM / SSO integration boundary

Payload remains the current identity authority for the LuckRead v1 Cloudflare deployment.

When Web/H5, Android/iOS, Creator Center, MCN Center and Developer/Open Platform require a unified enterprise-grade SSO layer, **Keycloak** may be integrated as an external IAM/identity-broker layer rather than replacing the LuckRead User Domain authority by default. The integration must preserve stable LuckRead user IDs and keep authorization/business roles under the platform contract.

Target boundary:

```text
Client
→ Worker / Auth Adapter
→ OIDC / OAuth2 Identity Provider
→ Identity Mapping
→ Payload/D1 User Authority
→ LuckRead API
```

Rules:

- no duplicate user authority;
- external subject IDs map to immutable LuckRead user IDs;
- OIDC/OAuth claims are validated server-side;
- Keycloak failure must not silently grant access;
- role/status/suspension remain enforced by LuckRead authorization;
- session/token implementation remains behind the public `/v1/auth/*` contract.

Keycloak is therefore **reserved, not required for v1**. No dependency is added until unified SSO has a concrete product requirement.

## 9. Security requirements

- Authentication is required for protected profile operations.
- Authorization is evaluated server-side.
- Sensitive fields are never returned unless explicitly allowed.
- Rate limiting and abuse controls are mandatory for registration/login.
- Request/correlation IDs must exist at the API boundary.
- Login/registration failures must use a stable error model and must not leak account existence unnecessarily.
- Registration risk controls must be compatible with the platform Risk/Trust contract when that system is implemented.

## 10. Audit requirements

At minimum, audit-sensitive identity changes:

- role change
- status change
- email identity change
- account suspension/reactivation
- privacy/consent change

Audit records must identify actor, target, action, timestamp and correlation/request ID when the operations layer is implemented.

## 11. Cost requirements

- Do not introduce a Worker/database write for every read.
- `/v1/me` may be cache-assisted only if invalidation cannot create stale authorization decisions.
- Authentication and authorization remain authoritative; cache cannot override account suspension or role state.
- Registration steps must not create redundant account records or duplicate verification state.

## 12. Acceptance criteria

1. Existing Payload login remains functional.
2. User records contain the contract fields with safe defaults.
3. Non-admin users cannot change role/status.
4. `verified` cannot be changed through ordinary user profile updates.
5. Suspended users cannot perform protected mutations.
6. Registration supports the contracted phone/email verification journey where those methods are enabled.
7. Duplicate username/account creation is handled safely and idempotently.
8. Registration failure states preserve recoverable user input.
9. Typecheck passes.
10. Payload local development starts successfully.
11. Migration/schema generation succeeds for the configured D1 adapter.
12. No Payload core source is modified or copied.
13. The implementation does not add downstream business domains.
14. Registration UI uses LuckRead-owned visual design and copy; TikTok is only a UX reference.

## 13. Implementation boundary

Implementation is limited to the Users collection and the minimum API/UI adapter required for this contract. Creator, social, feed, risk scoring, recommendation and commerce are separate contracts.
