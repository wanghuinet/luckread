-- GENERATED FILE. Do not hand-edit.
-- Regenerate with scripts/neon/generate-w07-flexible-offer-pricing-postgres-migration.mjs.
-- Source template: scripts/neon/templates/w07-flexible-offer-pricing-postgres.sql.

-- W07 D1-01 flexible membership offer pricing incremental migration.
-- Historical fixed-price versions are preserved as FIXED by the column default.
-- FLEXIBLE uses minimum/suggested/maximum minor-unit values; price_minor is NULL.
-- D1-04 orders and payment facts remain outside this database.
BEGIN;

ALTER TABLE membership_plan_versions
  ALTER COLUMN price_minor DROP NOT NULL,
  ADD COLUMN price_mode TEXT NOT NULL DEFAULT 'FIXED'
    CHECK (price_mode IN ('FIXED', 'FLEXIBLE')),
  ADD COLUMN minimum_price_minor INTEGER,
  ADD COLUMN suggested_price_minor INTEGER,
  ADD COLUMN maximum_price_minor INTEGER,
  ADD CONSTRAINT membership_plan_versions_price_mode_values_check CHECK (
    (price_mode = 'FIXED'
      AND price_minor IS NOT NULL
      AND minimum_price_minor IS NULL
      AND suggested_price_minor IS NULL
      AND maximum_price_minor IS NULL)
    OR
    (price_mode = 'FLEXIBLE'
      AND price_minor IS NULL
      AND minimum_price_minor BETWEEN 1 AND 2147483647
      AND suggested_price_minor BETWEEN minimum_price_minor AND 2147483647
      AND maximum_price_minor BETWEEN suggested_price_minor AND 2147483647)
  );

COMMIT;
