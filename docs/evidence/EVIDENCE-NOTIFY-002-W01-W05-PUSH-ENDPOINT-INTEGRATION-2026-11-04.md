# NOTIFY-002 W01 to W05 Push Endpoint Integration Evidence

- Feature: `NOTIFY-002`
- Evidence type: `integration`
- Status: `PASS`
- Repository: `wanghuinet/luckread`
- Branch: `feat/w05-push-endpoint-registration`
- Commit: `44e0b9ccde8c89bd71f54e39ad3d6b7bf27f4fd1`
- Workflow: [W05 Social Runtime CI](https://github.com/wanghuinet/luckread/actions/runs/41795601545)
- PR: [#1527](https://github.com/wanghuinet/luckread/pull/1527)

## Executed integration boundary

The dedicated Node/Vitest integration step `Run real W01 to W05 push endpoint SQLite integration` executes:

1. The actual W01 `PUT /api/v1/push/endpoints/{installationId}` route.
2. The shared production `createW05SocialCaller` transport implementation, with only the service-provider lookup injected by the test.
3. The actual W05 Worker `fetch` entrypoint and push-endpoint runtime.
4. The canonical W09 D1-03 migration `0001_notification_push_endpoints.sql` against Node SQLite, exercising the real owner-scoped SQL statements and constraints.

The five assertions cover endpoint registration and token non-disclosure, cross-account installation ownership conflict, permission-denied token clearing, owner-scoped deletion (including a non-owner no-op), and W08 authorization-before-W06-audit-before-W05 mutation ordering.

## Boundaries and exclusions

- W08 authorization and W06 audit service responses are test doubles in this integration suite. Their production services are not end-to-end exercised here.
- Cloudflare deployment/runtime binding resolution is not exercised; the integration injects a service provider into the same transport factory used by production.
- No production D1 migration or Worker deployment was performed by this evidence run.
- `securityE2E` remains `MISSING`; this evidence does not claim an end-to-end security certification.

This evidence supports only the `integration` field for `upsertPushEndpoint` and `deletePushEndpoint`.
