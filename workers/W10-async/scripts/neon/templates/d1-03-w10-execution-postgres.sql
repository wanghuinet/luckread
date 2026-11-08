-- NEON_D1_03_W10_ASYNC_EXECUTION_SCHEMA_V1
-- Target: luckread_governance (D1-03), PostgreSQL 18.
-- Logical entity owner: W10. W09 remains the sole Wrangler D1-03 migration-config owner.
-- Schema only: W10 runtime D1_03 binding and deployment remain separately gated.
-- No raw job/event payload, credentials, payment data or private messages are stored.

CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL,
  owner_worker TEXT NOT NULL CHECK (owner_worker IN (
    'W01', 'W02', 'W03', 'W04', 'W05', 'W06',
    'W07', 'W08', 'W09', 'W10', 'W11', 'W12'
  )),
  owner_task_id TEXT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  actor_id TEXT,
  subject_id TEXT,
  scope TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'ACCEPTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED',
    'CANCEL_REQUESTED', 'STOPPING', 'CANCELLED', 'EXPIRED',
    'PARTIALLY_COMPLETED', 'REQUIRES_ACTION', 'UNKNOWN'
  )),
  progress_current BIGINT,
  progress_total BIGINT,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  trace_id TEXT,
  error_code TEXT,
  result_ref TEXT,
  CHECK (
    (progress_current IS NULL AND progress_total IS NULL)
    OR (
      progress_current IS NOT NULL AND progress_total IS NOT NULL
      AND progress_current >= 0 AND progress_total >= 0
      AND progress_current <= progress_total
    )
  ),
  CHECK (char_length(operation_type) BETWEEN 1 AND 128),
  CHECK (char_length(resource_type) BETWEEN 1 AND 128),
  CHECK (char_length(resource_id) BETWEEN 1 AND 255),
  CHECK (char_length(scope) BETWEEN 1 AND 255)
);

CREATE INDEX idx_jobs_owner_state_updated
  ON jobs(owner_worker, state, updated_at);
CREATE INDEX idx_jobs_expires_at
  ON jobs(expires_at);

CREATE TABLE job_retries (
  retry_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  failure_class TEXT NOT NULL CHECK (failure_class IN ('transient', 'permanent', 'poison')),
  error_code TEXT,
  error_summary TEXT CHECK (error_summary IS NULL OR char_length(error_summary) <= 1024),
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(job_id, attempt_number),
  CONSTRAINT job_retries_job_fk
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE RESTRICT
);

CREATE INDEX idx_job_retries_next_attempt
  ON job_retries(next_attempt_at);

CREATE TABLE execution_dead_letters (
  dlq_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  consumer_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  producer TEXT NOT NULL CHECK (producer IN (
    'W01', 'W02', 'W03', 'W04', 'W05', 'W06',
    'W07', 'W08', 'W09', 'W10', 'W11', 'W12'
  )),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  last_error_class TEXT NOT NULL CHECK (last_error_class IN ('transient', 'permanent', 'poison')),
  last_error_summary TEXT NOT NULL CHECK (char_length(last_error_summary) BETWEEN 1 AND 1024),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL CHECK (last_seen_at >= first_seen_at),
  resolution_status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (resolution_status IN ('OPEN', 'REPLAYED', 'DISCARDED')),
  replay_id TEXT,
  resolved_at TIMESTAMPTZ,
  UNIQUE(event_id, consumer_name),
  CHECK (
    (resolution_status = 'OPEN' AND replay_id IS NULL AND resolved_at IS NULL)
    OR (resolution_status = 'REPLAYED' AND replay_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (resolution_status = 'DISCARDED' AND replay_id IS NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX idx_execution_dead_letters_state_first_seen
  ON execution_dead_letters(resolution_status, first_seen_at);

CREATE TABLE execution_inbox (
  consumer_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  producer TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN (
    'RECEIVED', 'PROCESSING', 'APPLIED', 'STALE', 'REJECTED', 'QUARANTINED'
  )),
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  last_error_code TEXT,
  PRIMARY KEY(consumer_name, event_id),
  UNIQUE(consumer_name, producer, idempotency_key, resource_id)
);

CREATE INDEX idx_execution_inbox_state_received
  ON execution_inbox(status, received_at);

CREATE TABLE execution_outbox (
  outbox_id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  producer TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version >= 1),
  payload_ref TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PUBLISHED', 'RETRY')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 1024),
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  CHECK (
    (status = 'PUBLISHED' AND published_at IS NOT NULL)
    OR (status IN ('PENDING', 'RETRY') AND published_at IS NULL)
  )
);

CREATE INDEX idx_execution_outbox_delivery
  ON execution_outbox(status, next_attempt_at);

CREATE TABLE operational_idempotency (
  idempotency_id TEXT PRIMARY KEY NOT NULL,
  owner_worker TEXT NOT NULL CHECK (owner_worker IN (
    'W01', 'W02', 'W03', 'W04', 'W05', 'W06',
    'W07', 'W08', 'W09', 'W10', 'W11', 'W12'
  )),
  operation_type TEXT NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  operation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
  UNIQUE(owner_worker, operation_type, scope, idempotency_key),
  CONSTRAINT operational_idempotency_job_fk
    FOREIGN KEY (operation_id) REFERENCES jobs(operation_id) ON DELETE RESTRICT
);

CREATE INDEX idx_operational_idempotency_expires_at
  ON operational_idempotency(expires_at);

COMMENT ON TABLE jobs IS
  'W10-owned async execution metadata only. The owner Worker retains business-state authority.';
COMMENT ON TABLE job_retries IS
  'W10-owned attempt metadata with transient/permanent/poison failure classes.';
COMMENT ON TABLE execution_dead_letters IS
  'W10-owned searchable quarantine metadata; native Queue DLQ remains the transport dead-letter authority.';
COMMENT ON TABLE execution_inbox IS
  'W10-owned consumer delivery identity/deduplication metadata, not producer-domain inbox state.';
COMMENT ON TABLE execution_outbox IS
  'W10-owned execution event metadata and opaque payload references, not producer-domain business outbox state.';
COMMENT ON TABLE operational_idempotency IS
  'W10 async-operation submission idempotency only; domain-local idempotency remains with its owner Worker.';
