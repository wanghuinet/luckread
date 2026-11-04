# W09 — Platform / Storage / Reliability

Canonical Worker identity: **W09**
Canonical responsibility: **Platform / Storage / Reliability**
Primary Task: **T25**
Primary D1 authority: **D1-03**

Canonical repository path: `workers/W09-platform`.

Boundary:
- Platform, storage, and reliability execution belongs to W09.
- Index/recommendation read-model authority belongs to W04.
- W09 does not acquire authoritative ownership of feed/search/recommendation data by path inference.
- W09 owns the D1-03 `NotificationPushEndpoint` runtime schema/migration; W05/T14 has only the explicit self-service registration/deletion writer delegation.
- `wrangler.d1-03-migrations.jsonc` is a migration-only D1 owner configuration and is not a Worker deployment configuration.
