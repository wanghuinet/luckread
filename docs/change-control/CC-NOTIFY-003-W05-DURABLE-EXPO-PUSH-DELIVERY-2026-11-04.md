# Change Control: W05 Durable Expo Push Delivery — 2026-11-04

- Change: NOTIFY-003-W05-DURABLE-EXPO-PUSH-DELIVERY
- Owner: W05 / T14
- Authority: W05 D1-02 social notifications; W09 remains primary D1-03 NotificationPushEndpoint owner; W05 T14 receives only the separate delivery-runtime delegation in `contracts/transport/W05-W09-notification-push-delivery.v1.json`
- Base: feat/w10-expo-server-sdk-adapter (stacked after the endpoint registration and Expo SDK adapter work)

## Decision

The product implementation contract freezes the existing 12-Worker, 5-D1 topology and prohibits adding a Worker, D1, Queue, Service Binding, or parallel domain service. Existing AUTH-013 Queues are account-state/audit queues and are not notification queues. Current topology has no W10-to-W05 Service Binding, and W01 must not be inserted as an internal Worker-to-Worker routing hop.

Accordingly, this slice keeps notification delivery inside the existing W05 notification authority and uses a durable Cloudflare Workflow resource hosted by the existing W05 Worker. It does not add a Worker, D1, Queue, or Service Binding. W10 remains unchanged as the generic async execution boundary; this delivery is a W05-owned notification lifecycle and does not grant W05 general D1-03 authority.

## Data and runtime boundaries

- social_notifications and the push outbox/delivery state remain in W05 D1-02.
- A D1-02 trigger creates a delivery intent atomically with a new inbox notification. Existing notifications are not backfilled.
- W05 reads only active endpoints belonging to the persisted W05 notification recipient (maximum 20 rows) and may conditionally clear only the exact token hash that Expo reported as `DeviceNotRegistered`; this is governed by `contracts/transport/W05-W09-notification-push-delivery.v1.json`. W09 remains the primary endpoint owner.
- Expo tokens are never returned through public APIs, logged, copied into Workflow results, or included in error messages.
- Push payloads contain only the notification ID and stable target references. Taps continue to open the in-app notification inbox; no untrusted URL is accepted.
- Delivery is at-least-once. Stable notification IDs, endpoint-scoped idempotency, leases, Expo receipts, bounded retry and invalid-token deactivation mitigate duplicates and stale endpoints. An Expo `ok` receipt is recorded as `PROVIDER_ACCEPTED`; it confirms provider acceptance, not that the operating system displayed the notification to the user.

## Activation and deployment gates

- PUSH_DELIVERY_ENABLED defaults to false; delivery is fail-closed until an operator explicitly enables it.
- D1-02 migration is a separate, manually confirmed workflow against an exact merged main SHA.
- W05 deployment requires the W09-owned D1-03 endpoint migration from the preceding endpoint module.
- Real Android/iOS notification delivery, notification tap routing, provider receipts and DeviceNotRegistered invalidation require device acceptance evidence before the feature is considered production-ready.
