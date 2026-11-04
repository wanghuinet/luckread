# W05 — Social / Community / Messaging / Notification

Canonical Worker identity: **W05**
Canonical responsibility: **Social / Community / Messaging / Notification**
Primary Tasks: **T11, T12, T13, T14**
Primary D1 authority: **D1-02**; scoped D1-03 runtime delivery state only where explicitly contracted.
- Scoped D1-03 write delegation: W09 owns `notification_push_endpoints` and its schema migration; W05/T14 may only register/delete the current user's Expo routing endpoint. W05 does not own the D1-03 migration directory.
- Scoped D1-03 entity: `notification_push_endpoints` (Expo routing endpoints only; separate `migrations-d1-03/` directory).

Canonical repository path: `workers/W05-social`.

Current boundary:
- Social/community relationship and interaction work belongs to W05 under approved Contracts and Mapping.
- Transaction / monetization authority belongs to W07 / D1-04.
- No unrestricted cross-D1 writes.
- No business implementation is admitted solely by directory presence.

Any new W05 runtime capability requires the applicable Task, Contract, Mapping, authorization, tests, and Evidence gates.
