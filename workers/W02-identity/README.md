# W02 — Identity / Account / Authorization

Better Auth 1.7.7 is the sole authentication authority and runs in W02 on D1-01.

W02 owns registration, credentials, login, sessions, logout/revocation, password change, password recovery, Account State and L0-L8 authorization.

W01 remains the public API / Payload boundary and forwards auth through W02_AUTH. W01 may enforce edge rate limits and compatibility adapters but must not verify credentials or own session state.

Production path: client -> W01 -> W02_AUTH -> W02/Better Auth -> D1-01.

No Worker/D1/Queue topology expansion is introduced.
