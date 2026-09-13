# P0 User Center / Profile / Settings / Account Lifecycle Contract v1.0

**Status:** PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING  
**Scope:** User-facing center, profile, account settings, security, privacy, preferences, device/session management, data controls and account lifecycle.  
**Dependency:** `08-P0-IDENTITY-AND-API-FOUNDATION-CONTRACT-v1.0.md`  

## 1. Goal

Provide a complete user-center experience without turning User Domain into a second authority for Creator, Content, Social, Feed, Commerce, Wallet, Notification or other domains.

The User Center is an aggregation and user-control surface. Domain ownership remains with the corresponding authoritative system.

## 2. Product Principles

- Borrow proven interaction patterns from mainstream consumer platforms, including short-video/social products such as TikTok, without copying brand identity, visual assets or proprietary copy.
- Keep high-frequency user actions simple and reversible where appropriate.
- Minimize initial registration/profile burden.
- Make security, privacy and consent understandable.
- Server-side authorization is authoritative.
- User Center must not expose Payload internal implementation types.
- User Center must not become a generic dumping ground for unrelated domain state.

## 3. User Center Information Architecture

```text
User Center
├── Profile / Personal Homepage
├── Account
│   ├── Username
│   ├── Email
│   ├── Phone
│   ├── Password
│   └── Linked Identity Providers
├── Security
│   ├── Devices
│   ├── Sessions
│   ├── Login History
│   ├── Security Alerts
│   └── Verification / Recovery
├── Privacy
│   ├── Profile Visibility
│   ├── Contact Permissions
│   ├── Interaction Permissions
│   ├── Recommendation Controls
│   └── Data Permissions
├── Notifications
│   ├── Push
│   ├── Comments
│   ├── Likes / Reactions
│   ├── Follows
│   ├── Messages
│   └── System
├── Content Preferences
│   ├── Interests
│   ├── Language
│   ├── Region
│   └── Personalization Controls
├── Personal Space
│   ├── Works
│   ├── Drafts
│   ├── Favorites
│   ├── History
│   ├── Likes
│   ├── Following
│   └── Comments
├── Data & Account
│   ├── Export Data
│   ├── Privacy Activity
│   ├── Account Recovery
│   ├── Deactivate
│   └── Delete Account
└── Help / Appeals
    ├── Help Center
    ├── Report
    ├── Account Appeal
    └── Security Appeal
```

Personal Space is an entry surface only. Its underlying records remain owned by their domains.

## 4. Profile / Personal Homepage

P0 profile capabilities:

- avatar
- username
- display name
- bio
- locale/timezone where applicable
- account status indicators where policy allows
- follow/follower entry points through Social
- content/work entry points through Content/Creator
- privacy-aware public profile rendering

The profile page must not expose private email, phone, security state, exact birth date or internal risk/moderation information.

Future creator/IP/MCN capabilities must be entered through their respective domains rather than added as arbitrary User fields.

## 5. Account Settings

### 5.1 Identity

Support where enabled:

- change username
- change email
- add/change phone
- link/unlink supported identity provider
- view verification state

Sensitive identity changes require recent authentication or step-up verification when risk policy requires it.

### 5.2 Password

Support:

- change password
- password strength validation
- forgot-password recovery
- session revocation after sensitive password changes according to security policy

Passwords must never be logged, returned or stored in plaintext.

### 5.3 Account Recovery

```text
Recovery Request
→ Identity Verification
→ Risk Evaluation
→ Recovery Action
→ Revoke / Rotate Sessions where required
→ Confirmation
→ Audit
```

Recovery must not become an account-enumeration oracle.

## 6. Device / Session Management

The platform must model sessions independently from the User record.

```text
User
└── Sessions
    ├── Web
    ├── Android
    ├── iOS
    └── Other Clients
```

Each session should support, subject to privacy/security policy:

- sessionId
- client type
- device label
- createdAt
- lastSeenAt
- approximate security metadata
- current/active state

Users must be able to revoke individual sessions and, where supported, revoke all other sessions.

Session revocation is authoritative and must take effect promptly.

## 7. Login History / Security Alerts

P0 should expose a user-readable security history for relevant events:

- successful login
- failed login where appropriate
- new device
- identity change
- password change
- recovery event
- session revocation
- security challenge

Do not expose secrets, internal detection rules, risk scores or unnecessary sensitive network/device details.

High-risk events may trigger notification and step-up verification.

## 8. Privacy Center

The privacy center must distinguish:

- required security/identity processing
- required legal/platform processing
- optional personalization
- optional marketing
- optional communication features

User controls should cover, where the relevant domain supports them:

- profile visibility
- contact permissions
- message permissions
- interaction permissions
- recommendation/personalization controls
- marketing consent
- optional data-sharing controls

Privacy settings cannot override safety, legal, rights or account-security enforcement.

## 9. Notification Settings

User Center provides the control surface; Notification Domain owns delivery state.

Settings should support categories such as:

- system/security
- comments/replies
- likes/reactions
- follows
- creator/content updates
- messages
- live reminders
- commerce/order notifications
- marketing notifications

Security-critical notifications cannot be silently disabled where policy requires delivery.

## 10. Content Preferences

Support:

- interests
- language
- region/locale
- content preference controls
- recommendation personalization controls
- sensitive-content preferences where policy permits

Preference state is not identity authority and must not be used to bypass safety, rights or eligibility rules.

## 11. Personal Space Aggregation

User Center may provide:

- My Works
- Drafts
- Favorites
- History
- Likes
- Following
- Comments
- Saved items
- Recently viewed

Authority mapping:

| User Center Surface | Authority |
|---|---|
| Profile | User / Profile |
| Works | Content / Creator |
| Drafts | Production |
| Favorites | Interaction / Social |
| History | Personal Activity / Analytics policy |
| Likes | Interaction |
| Following | Social |
| Comments | Interaction / Content policy |
| Notifications | Notification |
| Messages | Messaging |
| Orders | Commerce |
| Revenue | Ledger / Settlement |

User Center must aggregate references rather than duplicate authoritative records.

## 12. Account State Lifecycle

```text
ACTIVE
  ↓
RESTRICTED
  ↓
SUSPENDED
  ↓
DELETION_REQUESTED
  ↓
GRACE_PERIOD
  ↓
DELETED
```

Possible recovery transitions must be explicitly defined by policy.

Account deletion must not be implemented as an immediate blind database delete.

Deletion must evaluate:

- legal retention
- financial records
- copyright/rights obligations
- moderation/audit obligations
- user-generated content handling
- session revocation
- downstream deletion/anonymization events

## 13. Data Export

Users must be able to request an export of eligible personal data.

```text
Export Request
→ Authorization
→ Scope Calculation
→ Data Collection
→ Package Generation
→ Expiring Secure Download
→ Audit
```

Exports must exclude secrets and data the user is not authorized to receive.

Export packages must have expiration and access controls.

## 14. Account Deactivation / Deletion

The product must distinguish:

- temporary deactivation
- deletion request
- grace period
- final deletion/anonymization

Sensitive operations require re-authentication or step-up verification as appropriate.

A deletion request must create a durable operation state and idempotency key rather than relying on a single synchronous request.

## 15. Blocking / Muting Entry Points

User Center may expose shortcuts to:

- blocked users
- muted users
- restricted interactions

Actual relationship authority belongs to Social Domain.

Blocking/muting must propagate to downstream distribution, messaging and interaction eligibility according to Social and Feed contracts.

## 16. Help / Appeal Entry Points

User Center should provide navigation to:

- account help
- security help
- moderation appeal
- account restriction appeal
- copyright/rights dispute where applicable
- report submission

User Center does not own moderation decisions or appeal adjudication.

## 17. API Contract

Recommended stable APIs:

```text
GET    /v1/me
PATCH  /v1/me
GET    /v1/me/settings
PATCH  /v1/me/settings
GET    /v1/me/security
GET    /v1/me/sessions
DELETE /v1/me/sessions/{sessionId}
POST   /v1/me/sessions/revoke-all
GET    /v1/me/login-history
POST   /v1/me/recovery
POST   /v1/me/export
GET    /v1/me/export/{requestId}
POST   /v1/me/deactivate
POST   /v1/me/delete
GET    /v1/me/privacy
PATCH  /v1/me/privacy
GET    /v1/me/preferences
PATCH  /v1/me/preferences
```

All mutation APIs require:

- authenticated actor where applicable
- server-side authorization
- requestId
- correlationId
- DTO validation
- idempotency for retryable state-changing operations
- stable error model
- audit for sensitive operations

## 18. Event Contract

Representative events:

```text
user.profile.updated
user.email.changed
user.phone.changed
user.identity.linked
user.identity.unlinked
user.password.changed
user.session.created
user.session.revoked
user.security.alerted
user.privacy.updated
user.preference.updated
user.export.requested
user.export.ready
user.deactivation.requested
user.deletion.requested
user.deletion.completed
```

Events must use the platform event envelope and versioning rules.

Consumers must assume at-least-once delivery and implement idempotency.

## 19. Security / Privacy Requirements

- Never return passwords, password hashes, recovery secrets or authentication tokens through User Center APIs.
- Do not expose internal risk scores, moderation evidence or security detection rules.
- Sensitive mutations require step-up authentication when policy requires it.
- Session revocation must be server-authoritative.
- Cache must never override current authorization, suspension or revocation state.
- User enumeration must be minimized for registration, login, recovery and identity-change flows.
- Audit sensitive identity/security/privacy operations.
- Minimize collection and retention of device/network metadata.

## 20. Performance / Cost Contract

User Center reads may be cache-assisted when data is non-authoritative or invalidation-safe.

Do not synchronously fan out to every domain for every page render.

Recommended pattern:

```text
User Center Request
→ Authorization
→ User/Profile Authority
→ Cached/Derived Aggregates
→ Parallel Domain Reads where necessary
→ Composition
→ Response
```

High-frequency history, activity and preference telemetry must use queue/aggregation where appropriate rather than one authoritative database write per event.

## 21. UX States

Every User Center page must define:

- loading
- empty
- success
- validation error
- permission denied
- restricted account
- network failure
- server failure
- retrying
- partial data
- recovery/continue

Sensitive actions must have explicit confirmation and understandable consequences.

## 22. Acceptance Tests

### P0 Functional

- view/edit profile
- change username safely
- change password
- account recovery
- add/change email or phone where enabled
- link/unlink supported identity provider
- view sessions
- revoke one session
- revoke all other sessions
- view security history
- modify privacy settings
- modify notification settings
- modify preferences
- request data export
- deactivate account
- request account deletion

### P0 Security

- unauthorized profile mutation rejected
- session revocation effective
- suspended/restricted account policy enforced
- sensitive mutation requires step-up when required
- private fields never leak through public profile
- account enumeration resistance
- deletion cannot be triggered by another user
- export cannot expose another user's data

### P0 Reliability

- duplicate mutation request is safe
- retry does not duplicate deletion/export/recovery operation
- partial downstream failure produces recoverable state
- expired export link is inaccessible
- revoked session cannot silently continue

## 23. STOP Conditions

Implementation must stop if:

- User Center becomes authority for another domain's business data;
- profile APIs expose Payload internal types;
- password/recovery secrets are logged or returned;
- session revocation depends only on client behavior;
- account deletion is implemented as an unsafe synchronous blind delete;
- privacy controls bypass safety/rights/security requirements;
- Personal Space duplicates authoritative content/social/commerce records;
- sensitive mutations lack authorization or idempotency;
- data export can cross user boundaries;
- no recovery path exists for destructive operations.

## 24. Implementation Admission

Before code:

```text
Architecture
→ L1/L2/L3/L4 Traceability
→ UX Journey
→ Data Contract
→ API Contract
→ Event Contract
→ Permission/Security
→ Privacy
→ Failure/Recovery
→ Cost/Performance
→ Observability
→ Test/Acceptance
→ READY Gate
```

## 25. Status

**PRODUCT-ARCHITECTURE-COMPLETE / CONTRACT-READY / IMPLEMENTATION PENDING**

No implementation is authorized by this document alone until the required admission gates are satisfied.
