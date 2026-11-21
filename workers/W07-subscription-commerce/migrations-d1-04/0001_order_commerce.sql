-- PAY-002 source candidate for the isolated D1-04 commerce database.
-- Remote application requires a separate reviewed workflow and postflight.
-- Deliberately excludes Payment, Ledger, Refund and Entitlement tables.

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN ('CREATED','PENDING_PAYMENT','CONFIRMED','PROCESSING','COMPLETED','CANCELLED','FAILED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (typeof(version)='integer' AND version >= 1),
  currency TEXT NOT NULL CHECK (length(currency)=3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  subtotal_minor INTEGER NOT NULL CHECK (typeof(subtotal_minor)='integer' AND subtotal_minor BETWEEN 0 AND 9007199254740991),
  discount_minor INTEGER NOT NULL CHECK (typeof(discount_minor)='integer' AND discount_minor BETWEEN 0 AND subtotal_minor),
  tax_minor INTEGER NOT NULL CHECK (typeof(tax_minor)='integer' AND tax_minor BETWEEN 0 AND 9007199254740991),
  total_minor INTEGER NOT NULL CHECK (typeof(total_minor)='integer' AND total_minor BETWEEN 0 AND 9007199254740991 AND total_minor=subtotal_minor-discount_minor+tax_minor),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 1 AND 64 AND updated_at >= created_at),
  confirmed_at TEXT CHECK (confirmed_at IS NULL OR length(confirmed_at) BETWEEN 1 AND 64),
  cancelled_at TEXT CHECK (cancelled_at IS NULL OR length(cancelled_at) BETWEEN 1 AND 64),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 128)
);
CREATE INDEX ix_orders_customer_created_order ON orders(customer_id, created_at, order_id);
CREATE INDEX ix_orders_status_created_order ON orders(status, created_at, order_id);

CREATE TRIGGER orders_commercial_snapshot_immutable
BEFORE UPDATE OF order_id, customer_id, currency, subtotal_minor, discount_minor, tax_minor, total_minor, created_at ON orders
WHEN NEW.order_id IS NOT OLD.order_id OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.currency IS NOT OLD.currency OR NEW.subtotal_minor IS NOT OLD.subtotal_minor
  OR NEW.discount_minor IS NOT OLD.discount_minor OR NEW.tax_minor IS NOT OLD.tax_minor
  OR NEW.total_minor IS NOT OLD.total_minor OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'order commercial snapshot is immutable'); END;

CREATE TRIGGER orders_version_must_advance
BEFORE UPDATE ON orders
WHEN NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN SELECT RAISE(ABORT, 'order update requires version CAS and increasing updated_at'); END;

CREATE TRIGGER orders_status_transition_guard
BEFORE UPDATE OF status ON orders
WHEN NOT (
  (OLD.status='CREATED' AND NEW.status IN ('PENDING_PAYMENT','CONFIRMED','CANCELLED','FAILED'))
  OR (OLD.status='PENDING_PAYMENT' AND NEW.status IN ('CONFIRMED','CANCELLED','FAILED'))
  OR (OLD.status='CONFIRMED' AND NEW.status IN ('PROCESSING','COMPLETED','CANCELLED','FAILED'))
  OR (OLD.status='PROCESSING' AND NEW.status IN ('COMPLETED','FAILED'))
)
BEGIN SELECT RAISE(ABORT, 'invalid order state transition'); END;

CREATE TRIGGER orders_retained
BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT, 'orders are retained for financial audit'); END;

CREATE TABLE order_lines (
  order_line_id TEXT PRIMARY KEY NOT NULL CHECK (length(order_line_id) BETWEEN 1 AND 255),
  order_id TEXT NOT NULL CHECK (length(order_id) BETWEEN 1 AND 255),
  item_type TEXT NOT NULL CHECK (item_type IN ('CONTENT','MEMBERSHIP_PLAN','DIGITAL_GOOD','BUNDLE')),
  item_ref TEXT NOT NULL CHECK (length(item_ref) BETWEEN 1 AND 255),
  item_version TEXT NOT NULL CHECK (length(item_version) BETWEEN 1 AND 255),
  quantity INTEGER NOT NULL CHECK (typeof(quantity)='integer' AND quantity BETWEEN 1 AND 10000),
  unit_amount_minor INTEGER NOT NULL CHECK (typeof(unit_amount_minor)='integer' AND unit_amount_minor BETWEEN 0 AND 9007199254740991 AND unit_amount_minor <= 9007199254740991/quantity),
  line_subtotal_minor INTEGER NOT NULL CHECK (typeof(line_subtotal_minor)='integer' AND line_subtotal_minor BETWEEN 0 AND 9007199254740991 AND line_subtotal_minor=unit_amount_minor*quantity),
  line_discount_minor INTEGER NOT NULL CHECK (typeof(line_discount_minor)='integer' AND line_discount_minor BETWEEN 0 AND line_subtotal_minor),
  line_tax_minor INTEGER NOT NULL CHECK (typeof(line_tax_minor)='integer' AND line_tax_minor BETWEEN 0 AND 9007199254740991),
  line_total_minor INTEGER NOT NULL CHECK (typeof(line_total_minor)='integer' AND line_total_minor BETWEEN 0 AND 9007199254740991 AND line_total_minor=line_subtotal_minor-line_discount_minor+line_tax_minor),
  item_snapshot_json TEXT NOT NULL CHECK (length(item_snapshot_json) BETWEEN 2 AND 65536 AND json_valid(item_snapshot_json) AND json_type(item_snapshot_json)='object'),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64)
);
CREATE INDEX ix_order_lines_order_id ON order_lines(order_id);
CREATE INDEX ix_order_lines_item_ref_version ON order_lines(item_ref, item_version);

CREATE TRIGGER order_lines_require_order
BEFORE INSERT ON order_lines
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_id=NEW.order_id)
BEGIN SELECT RAISE(ABORT, 'order line requires an existing order'); END;
CREATE TRIGGER order_lines_immutable_update
BEFORE UPDATE ON order_lines
BEGIN SELECT RAISE(ABORT, 'order lines are immutable'); END;
CREATE TRIGGER order_lines_retained
BEFORE DELETE ON order_lines
BEGIN SELECT RAISE(ABORT, 'order lines are retained'); END;

CREATE TABLE order_create_idempotency (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 255),
  customer_id TEXT NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 256),
  operation_key TEXT NOT NULL CHECK (operation_key='POST /v1/commerce/orders'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('IN_PROGRESS','COMPLETED','FAILED')),
  response_status INTEGER CHECK (response_status IS NULL OR (typeof(response_status)='integer' AND response_status BETWEEN 100 AND 599)),
  response_json TEXT CHECK (response_json IS NULL OR (length(response_json)<=65536 AND json_valid(response_json))),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 1 AND 64),
  expires_at TEXT NOT NULL CHECK (length(expires_at) BETWEEN 1 AND 64 AND expires_at > created_at),
  UNIQUE (customer_id, operation_key, idempotency_key),
  CHECK (
    (state='IN_PROGRESS' AND response_status IS NULL AND response_json IS NULL)
    OR (state='COMPLETED' AND response_status IS NOT NULL AND response_status BETWEEN 100 AND 599 AND response_json IS NOT NULL)
    OR (state='FAILED' AND (
      (response_status IS NULL AND response_json IS NULL)
      OR (response_status IS NOT NULL AND response_status BETWEEN 400 AND 599 AND response_json IS NOT NULL)
    ))
  )
);
CREATE INDEX ix_order_create_idempotency_customer_created ON order_create_idempotency(customer_id, created_at);
CREATE INDEX ix_order_create_idempotency_expiration ON order_create_idempotency(expires_at);

-- A persisted Order must be tied to the completed idempotency response in the same D1 batch.
CREATE TRIGGER orders_require_matching_completed_idempotency
BEFORE INSERT ON orders
WHEN NOT EXISTS (
  SELECT 1 FROM order_create_idempotency
  WHERE customer_id = NEW.customer_id
    AND operation_key = 'POST /v1/commerce/orders'
    AND state = 'COMPLETED'
    AND response_json IS NOT NULL
    AND json_valid(response_json)
    AND json_extract(response_json, '$.orderId') = NEW.order_id
)
BEGIN SELECT RAISE(ABORT, 'order requires a matching completed idempotency response'); END;

CREATE TRIGGER order_create_idempotency_identity_immutable
BEFORE UPDATE OF id, customer_id, operation_key, idempotency_key, request_hash, created_at, expires_at ON order_create_idempotency
WHEN NEW.id IS NOT OLD.id OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.operation_key IS NOT OLD.operation_key OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'idempotency identity is immutable'); END;

CREATE TRIGGER order_create_idempotency_terminal_immutable
BEFORE UPDATE ON order_create_idempotency
WHEN OLD.state IN ('COMPLETED','FAILED')
BEGIN SELECT RAISE(ABORT, 'idempotency terminal result is immutable'); END;
