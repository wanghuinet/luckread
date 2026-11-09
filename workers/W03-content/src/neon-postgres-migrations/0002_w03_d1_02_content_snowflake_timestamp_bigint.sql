-- GENERATED FILE. Do not hand-edit.
-- Migration: d1-02-w03-content-snowflake-timestamp-bigint-v1
-- Owner: W03. This is a forward-only correction to the already-applied v1 schema.
-- SQLite/D1 INTEGER is signed 64-bit; PostgreSQL INTEGER is only signed 32-bit.
-- Unix millisecond timestamps require BIGINT. No rows or IDs are rewritten.

BEGIN;

ALTER TABLE public.content_id_snowflake_state
  ALTER COLUMN last_timestamp_ms TYPE BIGINT
  USING last_timestamp_ms::BIGINT;

COMMIT;
