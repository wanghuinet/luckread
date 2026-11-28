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
    (offer_kind = 'FOUNDING' AND price_mode = 'FIXED' AND founding_capacity IS NOT NULL
      AND founding_capacity BETWEEN 1 AND 2147483647)
  );

-- The first FOUNDING version establishes one lifetime capacity for the offer.
-- Every later version must preserve both offer kind and capacity at the DB boundary.
CREATE FUNCTION w07_guard_founding_offer_plan_version()
RETURNS trigger
LANGUAGE plpgsql
AS $
DECLARE
  existing_min_capacity INTEGER;
  existing_max_capacity INTEGER;
BEGIN
  IF NEW.offer_kind = 'FOUNDING' AND NEW.price_mode <> 'FIXED' THEN
    RAISE EXCEPTION 'founding offers require fixed pricing'
      USING ERRCODE = '23514';
  END IF;

  SELECT MIN(founding_capacity), MAX(founding_capacity)
    INTO existing_min_capacity, existing_max_capacity
    FROM membership_plan_versions
    WHERE plan_id = NEW.plan_id AND offer_kind = 'FOUNDING';

  IF existing_min_capacity IS NOT NULL AND (
    existing_min_capacity IS DISTINCT FROM existing_max_capacity
    OR NEW.offer_kind <> 'FOUNDING'
    OR NEW.founding_capacity IS DISTINCT FROM existing_min_capacity
  ) THEN
    RAISE EXCEPTION 'founding offer kind and lifetime capacity are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER membership_plan_versions_founding_offer_immutable
BEFORE INSERT ON membership_plan_versions
FOR EACH ROW EXECUTE FUNCTION w07_guard_founding_offer_plan_version();

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

CREATE TABLE membership_founding_reservation_payment_events (
  reservation_id TEXT PRIMARY KEY
    REFERENCES membership_founding_reservations (reservation_id) ON DELETE RESTRICT,
  provider_event_reference TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
