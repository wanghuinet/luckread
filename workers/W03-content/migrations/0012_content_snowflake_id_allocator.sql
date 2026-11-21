-- Central allocator for Snowflake-compatible article/video IDs.
-- The row is shared by all W03 isolates through the existing authoritative D1-02.
-- IDs remain decimal TEXT at the API and persistence boundaries; this migration
-- does not rewrite existing IDs or change any other content ID family.

CREATE TABLE content_id_snowflake_state (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  last_timestamp_ms INTEGER NOT NULL CHECK (last_timestamp_ms >= -1),
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 0 AND 4095)
);

-- A timestamp older than the first real allocation and a full prior sequence
-- guarantee the first allocation resets the sequence to zero.
INSERT INTO content_id_snowflake_state (id, last_timestamp_ms, sequence)
VALUES (1, -1, 4095);
