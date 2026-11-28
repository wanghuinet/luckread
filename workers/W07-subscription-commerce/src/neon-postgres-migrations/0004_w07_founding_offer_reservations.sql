-- W07 D1-01 founding offer capacity and reservation state.
-- D1-04 order/payment facts remain in their existing database.
BEGIN;

ALTER TABLE membership_plan_versions
  ADD COLUMN offer_kind TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (offer_kind IN ('STANDARD', 'FOUNDING')),
  ADD COLUMN founding_capacity INTEGER,
  ADD CONSTRAINT membership_plan_versions_founding_capacity_check CHECK (
    (offer_kind = 'STANDARD' AND founding_capacity IS NULL)
    OR
    (offer_kind = 'FOUNDING' AND founding_capacity IS NOT NULL
      AND founding_capacity BETWEEN 1 AND 2147483647)
  );

CREATE TABLE membership_founding_reservations (
  reservation_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  plan_version INTEGER NOT NULL CHECK (plan_version > 0),
  subscriber_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  order_reference TEXT,
  state TEXT NOT NULL CHECK (state IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  CONSTRAINT membership_founding_reservations_idempotency_unique
    UNIQUE (subscriber_id, idempotency_key),
  CONSTRAINT membership_founding_reservations_order_unique
    UNIQUE (order_reference),
  CONSTRAINT membership_founding_reservations_state_timestamps_check CHECK (
    (state = 'COMMITTED' AND committed_at IS NOT NULL AND released_at IS NULL)
    OR (state IN ('HELD', 'RELEASED', 'EXPIRED') AND committed_at IS NULL)
  )
);

CREATE INDEX membership_founding_reservations_capacity_idx
  ON membership_founding_reservations (plan_id, state, expires_at);

CREATE INDEX membership_founding_reservations_order_idx
  ON membership_founding_reservations (order_reference)
  WHERE order_reference IS NOT NULL;

COMMIT;
