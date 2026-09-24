# W06 D1-03 migrations

The canonical AuditEvent persistence migration is now admitted in source at:

- `0001_audit_event.sql`
- Canonical schema source: `contracts/schemas/common/audit-event.json`
- Target: W06 / D1-03 / `secondary` / `bda1d247-a371-4244-91ae-aef96034db7f`

Remote application is separately gated by:

- `.github/workflows/w06-audit-event-migration.yml`

The migration is fail-closed for an already-existing `audit_events` table and is intended for the controlled zero-row target only. This source admission does not itself mutate Cloudflare D1.
