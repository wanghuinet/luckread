-- NEON_D1_04_W07_RENEWAL_CYCLES_SCHEMA_V1
-- Target: luckread_finance (D1-04), PostgreSQL 18; owner W07 / PAY-004.
-- Additive dependency: 0001 order/payment + 0002 saved-method/mandate schemas.
-- Translates only migrations-d1-04/0004_subscription_renewal_cycles.sql.
-- W10 orchestrates only; it never reads/writes D1-04 or decides payment/entitlement.
-- The seeded scheduler singleton is control metadata, not business-data import.
-- No entitlement, ledger, user, media, RevenueCat, refund, billing or revocation tables.
-- No foreign keys; preserve source trigger-enforced relationships.
-- W07_RENEWAL_CYCLES_SOURCE_SHA256=f1d2678de9c834a7d564ec14bdc461bb6b2bbcb92381d9770bbfafb89eff2044
-- BASE_ORDER_PAYMENT_SCHEMA_SHA256=26549a4e71010813040f11c7c8169091bc48620774bc5cf4d5f0483651ad7d75
-- BASE_SAVED_METHODS_MANDATES_SCHEMA_SHA256=71778e8193100670b1d33c733fdf4eac0dae552c2515c54eb3d793860fe10947
-- RENEWAL_CYCLES_SCHEMA_CONTRACT_SEMANTIC_SHA256=b841dc40463e564b5511c3c31de41e7f76ab5b1de781e48f75c7ed7101411082
-- BASE_D1_04_CUMULATIVE_CONTRACT_SEMANTIC_SHA256=19cca9e7131920d6e0091aa3d640869cf1f6a5b73a2b710f895eb5d4fbe1fc5b
-- D1_04_OWNER_LEDGER_CONTRACT_SHA256=cb867e81ea395b0a652173b672ed40a3217ba42f875bf5a1302d484f574f7da5
-- D1_04_OWNER_BOUNDARY_CONTRACT_SHA256=48cda5d56a467c26cb2b3a2d018f01ab2ddd52aaaa4f13dfa9d1adf2e26e1bb9
-- W10_RENEWAL_WORKFLOW_CONTRACT_SHA256=33fa5a4f83ded7925f8e200a263c991ea6b8dc72439cc66cbdd6ac6d1267d475

CREATE TABLE subscription_renewal_cycles (
  cycle_id TEXT PRIMARY KEY NOT NULL CHECK (char_length(cycle_id)=30 AND cycle_id ~ '^rcy_[A-Za-z0-9]{26}$'),
  provider TEXT NOT NULL CHECK (provider='hyperswitch'),
  merchant_id TEXT NOT NULL CHECK (char_length(merchant_id) BETWEEN 1 AND 256),
  subscription_id TEXT NOT NULL CHECK (char_length(subscription_id) BETWEEN 1 AND 256),
  subscriber_id TEXT NOT NULL CHECK (char_length(subscriber_id) BETWEEN 1 AND 256),
  plan_id TEXT NOT NULL CHECK (char_length(plan_id) BETWEEN 1 AND 255),
  plan_version BIGINT NOT NULL CHECK (plan_version>=1),
  cycle_start TIMESTAMPTZ NOT NULL,
  cycle_end TIMESTAMPTZ NOT NULL CHECK (cycle_end>cycle_start),
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('MONTHLY','YEARLY')),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  offer_snapshot_json TEXT NOT NULL CHECK (octet_length(offer_snapshot_json) BETWEEN 2 AND 65536 AND jsonb_typeof(offer_snapshot_json::jsonb)='object'),
  amount_minor BIGINT CHECK (amount_minor IS NULL OR amount_minor BETWEEN 0 AND 9007199254740991),
  pricing_snapshot_json TEXT CHECK (pricing_snapshot_json IS NULL OR (octet_length(pricing_snapshot_json) BETWEEN 2 AND 65536 AND jsonb_typeof(pricing_snapshot_json::jsonb)='object')),
  payment_method_id TEXT CHECK (payment_method_id IS NULL OR (char_length(payment_method_id) BETWEEN 1 AND 255 AND payment_method_id ~ '^[!-~]+$')),
  mandate_record_id TEXT CHECK (mandate_record_id IS NULL OR (char_length(mandate_record_id)=30 AND mandate_record_id ~ '^mnd_[A-Za-z0-9]{26}$')),
  order_id TEXT CHECK (order_id IS NULL OR char_length(order_id) BETWEEN 1 AND 255),
  payment_id TEXT CHECK (payment_id IS NULL OR (char_length(payment_id)=30 AND payment_id ~ '^pay_[A-Za-z0-9]{26}$')),
  state TEXT NOT NULL CHECK (state IN ('AWAITING_PRICING','AWAITING_MANDATE','PREPARED','PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  attempt_number BIGINT NOT NULL DEFAULT 0 CHECK (attempt_number BETWEEN 0 AND 20),
  provider_response_status TEXT CHECK (provider_response_status IS NULL OR provider_response_status IN ('requires_payment_method','requires_confirmation','requires_customer_action','requires_merchant_action','requires_capture','processing','succeeded','failed','cancelled','cancelled_post_capture','partially_captured','partially_captured_and_capturable','expired')),
  outcome_code TEXT CHECK (outcome_code IS NULL OR char_length(outcome_code) BETWEEN 1 AND 128),
  subscription_sync_state TEXT NOT NULL DEFAULT 'PENDING' CHECK (subscription_sync_state IN ('PENDING','APPLIED','RECONCILIATION_REQUIRED')),
  subscription_sync_updated_at TIMESTAMPTZ,
  subscription_sync_error_code TEXT CHECK (subscription_sync_error_code IS NULL OR char_length(subscription_sync_error_code) BETWEEN 1 AND 128),
  lease_token TEXT CHECK (lease_token IS NULL OR char_length(lease_token) BETWEEN 1 AND 128),
  lease_expires_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL CHECK (updated_at>=created_at),
  CHECK ((state='AWAITING_PRICING' AND amount_minor IS NULL AND pricing_snapshot_json IS NULL) OR (state<>'AWAITING_PRICING' AND amount_minor IS NOT NULL AND pricing_snapshot_json IS NOT NULL)),
  CHECK ((state IN ('PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED') AND payment_method_id IS NOT NULL AND mandate_record_id IS NOT NULL AND order_id IS NOT NULL AND payment_id IS NOT NULL) OR state NOT IN ('PAYMENT_READY','SUBMITTING','SUBMITTED','SUCCEEDED','FAILED')),
  CHECK ((state='SUBMITTING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state<>'SUBMITTING' AND lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((payment_method_id IS NULL)=(mandate_record_id IS NULL)),
  CHECK ((subscription_sync_state='PENDING' AND subscription_sync_updated_at IS NULL AND subscription_sync_error_code IS NULL) OR (subscription_sync_state='APPLIED' AND subscription_sync_updated_at IS NOT NULL AND subscription_sync_error_code IS NULL) OR (subscription_sync_state='RECONCILIATION_REQUIRED' AND subscription_sync_updated_at IS NOT NULL AND subscription_sync_error_code IS NOT NULL)),
  CHECK ((state IN ('SUCCEEDED','FAILED') AND subscription_sync_state IN ('PENDING','APPLIED','RECONCILIATION_REQUIRED')) OR (state NOT IN ('SUCCEEDED','FAILED') AND subscription_sync_state='PENDING'))
);

CREATE UNIQUE INDEX ux_subscription_renewal_cycles_subscription_cycle ON subscription_renewal_cycles(subscription_id,cycle_start);
CREATE UNIQUE INDEX ux_subscription_renewal_cycles_payment ON subscription_renewal_cycles(provider,merchant_id,payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX ix_subscription_renewal_cycles_state_updated ON subscription_renewal_cycles(state,updated_at,cycle_id);
CREATE INDEX ix_subscription_renewal_cycles_subscriber_cycle ON subscription_renewal_cycles(subscriber_id,cycle_start,cycle_end);

CREATE TABLE subscription_renewal_scheduler_state (
  state_id TEXT PRIMARY KEY NOT NULL CHECK (state_id='subscription-renewals'),
  cursor_period_end TIMESTAMPTZ,
  cursor_subscription_id TEXT CHECK (cursor_subscription_id IS NULL OR char_length(cursor_subscription_id) BETWEEN 1 AND 256),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version>=1),
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK ((cursor_period_end IS NULL)=(cursor_subscription_id IS NULL))
);
INSERT INTO subscription_renewal_scheduler_state(state_id,cursor_period_end,cursor_subscription_id,version,updated_at)
VALUES ('subscription-renewals',NULL,NULL,1,TIMESTAMPTZ '1970-01-01T00:00:00.000Z');

CREATE FUNCTION w07_d104_renewal_cycles_source_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 CASE TG_ARGV[0]
 WHEN 'subscription_renewal_cycles_initial_state_guard' THEN
  IF NEW.state<>'AWAITING_PRICING' OR NEW.amount_minor IS NOT NULL OR NEW.pricing_snapshot_json IS NOT NULL
   OR NEW.payment_method_id IS NOT NULL OR NEW.mandate_record_id IS NOT NULL OR NEW.order_id IS NOT NULL
   OR NEW.payment_id IS NOT NULL OR NEW.attempt_number<>0 OR NEW.provider_response_status IS NOT NULL
   OR NEW.outcome_code IS NOT NULL OR NEW.subscription_sync_state<>'PENDING'
   OR NEW.subscription_sync_updated_at IS NOT NULL OR NEW.subscription_sync_error_code IS NOT NULL
   OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.version<>1 THEN
   RAISE EXCEPTION 'new renewal cycles must start awaiting authoritative pricing' USING ERRCODE='23514';
  END IF;
 WHEN 'subscription_renewal_cycles_identity_immutable' THEN
  IF NEW.cycle_id IS DISTINCT FROM OLD.cycle_id OR NEW.provider IS DISTINCT FROM OLD.provider
   OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
   OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
   OR NEW.plan_version IS DISTINCT FROM OLD.plan_version OR NEW.cycle_start IS DISTINCT FROM OLD.cycle_start
   OR NEW.cycle_end IS DISTINCT FROM OLD.cycle_end OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval
   OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.offer_snapshot_json IS DISTINCT FROM OLD.offer_snapshot_json
   OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'renewal cycle identity and offer snapshot are immutable' USING ERRCODE='23514';
  END IF;
 WHEN 'subscription_renewal_cycles_resolved_snapshot_immutable' THEN
  IF (OLD.amount_minor IS NOT NULL AND NEW.amount_minor IS DISTINCT FROM OLD.amount_minor)
   OR (OLD.pricing_snapshot_json IS NOT NULL AND NEW.pricing_snapshot_json IS DISTINCT FROM OLD.pricing_snapshot_json)
   OR (OLD.payment_method_id IS NOT NULL AND NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id)
   OR (OLD.mandate_record_id IS NOT NULL AND NEW.mandate_record_id IS DISTINCT FROM OLD.mandate_record_id) THEN
   RAISE EXCEPTION 'resolved renewal amount, price decision and mandate identity are immutable' USING ERRCODE='23514';
  END IF;
 WHEN 'subscription_renewal_cycles_version_guard' THEN
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
   RAISE EXCEPTION 'renewal-cycle update requires version CAS and increasing updated_at' USING ERRCODE='23514';
  END IF;
 WHEN 'subscription_renewal_cycles_state_transition_guard' THEN
  IF NOT (
   (OLD.state='AWAITING_PRICING' AND NEW.state IN ('AWAITING_PRICING','AWAITING_MANDATE','PREPARED','RECONCILIATION_REQUIRED'))
   OR (OLD.state='AWAITING_MANDATE' AND NEW.state IN ('AWAITING_MANDATE','PREPARED','RECONCILIATION_REQUIRED'))
   OR (OLD.state='PREPARED' AND NEW.state IN ('PREPARED','AWAITING_MANDATE','PAYMENT_READY','RECONCILIATION_REQUIRED'))
   OR (OLD.state='PAYMENT_READY' AND NEW.state IN ('PAYMENT_READY','SUBMITTING','RECONCILIATION_REQUIRED'))
   OR (OLD.state='SUBMITTING' AND NEW.state IN ('SUBMITTING','PAYMENT_READY','SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
   OR (OLD.state='SUBMITTED' AND NEW.state IN ('SUBMITTED','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED'))
   OR (OLD.state='FAILED' AND NEW.state IN ('FAILED','PREPARED','RECONCILIATION_REQUIRED'))
   OR (OLD.state IN ('SUCCEEDED','RECONCILIATION_REQUIRED') AND NEW.state=OLD.state)
  ) THEN RAISE EXCEPTION 'forbidden renewal-cycle state transition' USING ERRCODE='23514'; END IF;
 WHEN 'subscription_renewal_cycles_sync_state_transition_guard' THEN
  IF NOT (
   (OLD.subscription_sync_state=NEW.subscription_sync_state
    AND OLD.subscription_sync_updated_at IS NOT DISTINCT FROM NEW.subscription_sync_updated_at
    AND OLD.subscription_sync_error_code IS NOT DISTINCT FROM NEW.subscription_sync_error_code)
   OR (OLD.subscription_sync_state='PENDING' AND NEW.subscription_sync_state IN ('APPLIED','RECONCILIATION_REQUIRED')
    AND OLD.state IN ('SUCCEEDED','FAILED') AND NEW.state=OLD.state)
   OR (OLD.subscription_sync_state='APPLIED' AND NEW.subscription_sync_state='PENDING'
    AND OLD.state='FAILED' AND NEW.state='PREPARED'
    AND NEW.subscription_sync_updated_at IS NULL AND NEW.subscription_sync_error_code IS NULL)
  ) THEN RAISE EXCEPTION 'renewal outcome sync state transition is not permitted' USING ERRCODE='23514'; END IF;
 WHEN 'subscription_renewal_cycles_order_binding_guard' THEN
  IF NEW.order_id IS NOT NULL AND (
   NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.order_id=NEW.order_id
    AND o.customer_id=NEW.subscriber_id AND o.currency=NEW.currency AND o.total_minor=NEW.amount_minor)
   OR NOT EXISTS (SELECT 1 FROM public.order_lines l WHERE l.order_id=NEW.order_id
    AND l.item_type='MEMBERSHIP_PLAN' AND l.item_ref=NEW.plan_id AND l.item_version=NEW.plan_version::text
    AND jsonb_typeof(l.item_snapshot_json::jsonb)='object'
    AND l.item_snapshot_json::jsonb #>> '{subscriptionRenewal,subscriptionId}'=NEW.subscription_id
    AND l.item_snapshot_json::jsonb #>> '{subscriptionRenewal,cycleStart}'=to_char(NEW.cycle_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    AND l.item_snapshot_json::jsonb #>> '{subscriptionRenewal,cycleEnd}'=to_char(NEW.cycle_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ) THEN RAISE EXCEPTION 'renewal cycle Order must match subscription, cycle and commercial snapshot' USING ERRCODE='23514'; END IF;
 WHEN 'subscription_renewal_cycles_payment_binding_guard' THEN
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payments p
   WHERE p.payment_id=NEW.payment_id AND p.order_id=NEW.order_id AND p.customer_id=NEW.subscriber_id
    AND p.provider=NEW.provider AND p.merchant_id=NEW.merchant_id
    AND p.amount_minor=NEW.amount_minor AND p.currency=NEW.currency) THEN
   RAISE EXCEPTION 'renewal cycle Payment must match its Order and immutable commercial snapshot' USING ERRCODE='23514';
  END IF;
 WHEN 'subscription_renewal_cycles_requires_active_mandate' THEN
  IF NEW.state IN ('PAYMENT_READY','SUBMITTING') AND NOT EXISTS (
   SELECT 1 FROM public.payment_mandates m JOIN public.saved_payment_methods s
    ON s.provider=m.provider AND s.merchant_id=m.merchant_id AND s.customer_id=m.customer_id
    AND s.payment_method_id=m.payment_method_id
   WHERE m.mandate_record_id=NEW.mandate_record_id AND m.provider=NEW.provider
    AND m.merchant_id=NEW.merchant_id AND m.customer_id=NEW.subscriber_id
    AND m.payment_method_id=NEW.payment_method_id AND m.status='ACTIVE'
  ) THEN RAISE EXCEPTION 'recurring charge requires a matching currently-active provider mandate' USING ERRCODE='23514'; END IF;
 WHEN 'subscription_renewal_cycles_retained' THEN
  RAISE EXCEPTION 'renewal cycle audit records are retained' USING ERRCODE='23514';
 WHEN 'subscription_renewal_scheduler_state_identity_immutable' THEN
  IF NEW.state_id IS DISTINCT FROM OLD.state_id THEN RAISE EXCEPTION 'renewal scheduler identity is immutable' USING ERRCODE='23514'; END IF;
 WHEN 'subscription_renewal_scheduler_state_version_guard' THEN
  IF NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at THEN
   RAISE EXCEPTION 'renewal scheduler update requires version CAS and increasing updated_at' USING ERRCODE='23514';
  END IF;
 WHEN 'subscription_renewal_scheduler_state_retained' THEN
  RAISE EXCEPTION 'renewal scheduler state is retained' USING ERRCODE='23514';
 ELSE
  RAISE EXCEPTION 'UNKNOWN_W07_D104_RENEWAL_TRIGGER_ACTION_%',TG_ARGV[0] USING ERRCODE='55000';
 END CASE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_renewal_cycles_initial_state_guard BEFORE INSERT ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_initial_state_guard');
CREATE TRIGGER subscription_renewal_cycles_identity_immutable BEFORE UPDATE OF cycle_id,provider,merchant_id,subscription_id,subscriber_id,plan_id,plan_version,cycle_start,cycle_end,billing_interval,currency,offer_snapshot_json,created_at ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_identity_immutable');
CREATE TRIGGER subscription_renewal_cycles_resolved_snapshot_immutable BEFORE UPDATE OF amount_minor,pricing_snapshot_json,payment_method_id,mandate_record_id ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_resolved_snapshot_immutable');
CREATE TRIGGER subscription_renewal_cycles_version_guard BEFORE UPDATE ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_version_guard');
CREATE TRIGGER subscription_renewal_cycles_state_transition_guard BEFORE UPDATE OF state ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_state_transition_guard');
CREATE TRIGGER subscription_renewal_cycles_sync_state_transition_guard BEFORE UPDATE ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_sync_state_transition_guard');
CREATE TRIGGER subscription_renewal_cycles_order_binding_guard BEFORE UPDATE OF order_id ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_order_binding_guard');
CREATE TRIGGER subscription_renewal_cycles_payment_binding_guard BEFORE UPDATE OF payment_id ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_payment_binding_guard');
CREATE TRIGGER subscription_renewal_cycles_requires_active_mandate BEFORE UPDATE OF state ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_requires_active_mandate');
CREATE TRIGGER subscription_renewal_cycles_retained BEFORE DELETE ON subscription_renewal_cycles FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_cycles_retained');
CREATE TRIGGER subscription_renewal_scheduler_state_identity_immutable BEFORE UPDATE OF state_id ON subscription_renewal_scheduler_state FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_scheduler_state_identity_immutable');
CREATE TRIGGER subscription_renewal_scheduler_state_version_guard BEFORE UPDATE ON subscription_renewal_scheduler_state FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_scheduler_state_version_guard');
CREATE TRIGGER subscription_renewal_scheduler_state_retained BEFORE DELETE ON subscription_renewal_scheduler_state FOR EACH ROW EXECUTE FUNCTION w07_d104_renewal_cycles_source_guard('subscription_renewal_scheduler_state_retained');

COMMENT ON TABLE subscription_renewal_cycles IS 'W07 D1-04 recurring billing-cycle facts; provider outcome reconciliation precedes scoped D1-01 subscription sync.';
COMMENT ON TABLE subscription_renewal_scheduler_state IS 'W07 D1-04 singleton scheduler cursor control metadata; not business data.';
