/// <reference types="@cloudflare/workers-types" />

/**
 * W03's Snowflake-compatible content ID allocator.
 *
 * The chosen upstream package documents the same 42/10/12 layout, but its
 * sequence is process-local. Cloudflare isolates do not share in-memory state.
 * W03 therefore allocates the logical timestamp + sequence atomically through
 * the single authoritative D1-02 state row and keeps the decimal ID as a string.
 */

export const CONTENT_SNOWFLAKE_EPOCH_MS = 1_288_834_974_657 // 2010-11-04T01:42:54.657Z (Twitter Snowflake epoch)

const TIMESTAMP_BITS = BigInt(42)
const NODE_BITS = BigInt(10)
const SEQUENCE_BITS = BigInt(12)
const SEQUENCE_MAX = (1 << 12) - 1
const NODE_ID = BigInt(1)
const TIMESTAMP_MAX = (BigInt(1) << TIMESTAMP_BITS) - BigInt(1)
const SEQUENCE_MASK = (BigInt(1) << SEQUENCE_BITS) - BigInt(1)
const SHIFT_TOTAL = NODE_BITS + SEQUENCE_BITS

interface AllocatorRow {
  last_timestamp_ms: number
  sequence: number
}

export type ContentSnowflakeD1 = Pick<D1Database, 'prepare'>

/**
 * Encodes a Unix millisecond timestamp and sequence as a positive 64-bit
 * Snowflake-layout decimal string. Never cross the API boundary as Number.
 */
export const encodeContentSnowflakeId = (timestampMs: number, sequence: number): string => {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < CONTENT_SNOWFLAKE_EPOCH_MS) {
    throw new RangeError('CONTENT_SNOWFLAKE_TIMESTAMP_OUT_OF_RANGE')
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > SEQUENCE_MAX) {
    throw new RangeError('CONTENT_SNOWFLAKE_SEQUENCE_OUT_OF_RANGE')
  }

  const timestamp = BigInt(timestampMs) - BigInt(CONTENT_SNOWFLAKE_EPOCH_MS)
  if (timestamp < BigInt(0) || timestamp > TIMESTAMP_MAX) {
    throw new RangeError('CONTENT_SNOWFLAKE_TIMESTAMP_OUT_OF_RANGE')
  }

  const nodePart = NODE_ID << SEQUENCE_BITS
  const sequencePart = BigInt(sequence) & SEQUENCE_MASK
  return ((timestamp << SHIFT_TOTAL) | nodePart | sequencePart).toString(10)
}

/**
 * Allocates from one D1 row shared by every W03 isolate. SQL serializes updates
 * to this row so identical timestamps cannot reuse a sequence. On clock rollback
 * the timestamp stays at the last allocated millisecond and sequence increases.
 * If all 4096 slots are used before the clock advances, this fails closed.
 */
export const allocateContentSnowflakeId = async (
  db: ContentSnowflakeD1,
  nowMs = Date.now(),
): Promise<string> => {
  if (!Number.isSafeInteger(nowMs) || nowMs < CONTENT_SNOWFLAKE_EPOCH_MS) {
    throw new RangeError('CONTENT_SNOWFLAKE_TIMESTAMP_OUT_OF_RANGE')
  }

  const row = await db.prepare(`
    UPDATE content_id_snowflake_state
       SET sequence = CASE
         WHEN ? > last_timestamp_ms THEN 0
         ELSE sequence + 1
       END,
       last_timestamp_ms = MAX(last_timestamp_ms, ?)
     WHERE id = 1
       AND (? > last_timestamp_ms OR sequence < 4095)
    RETURNING last_timestamp_ms, sequence
  `).bind(nowMs, nowMs, nowMs).first<AllocatorRow>()

  if (
    !row ||
    !Number.isSafeInteger(row.last_timestamp_ms) ||
    !Number.isInteger(row.sequence) ||
    row.sequence < 0 ||
    row.sequence > SEQUENCE_MAX
  ) {
    throw new Error('CONTENT_SNOWFLAKE_SEQUENCE_EXHAUSTED')
  }

  return encodeContentSnowflakeId(row.last_timestamp_ms, row.sequence)
}
