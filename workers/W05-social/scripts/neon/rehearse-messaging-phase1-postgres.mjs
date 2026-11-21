import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'

const connectionString = process.env.MESSAGING_TEST_DATABASE_URL
if (!connectionString) throw new Error('MESSAGING_TEST_DATABASE_URL is required')
const pool = new Pool({ connectionString, max: 2 })
try {
  const migration = readFileSync(resolve('workers/W05-social/src/neon-postgres-migrations/0002_w05_messaging_core.sql'), 'utf8')
  await pool.query(migration)

  const tables = await pool.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  )
  const expectedTables = [
    'social_conversation_memberships',
    'social_conversations',
    'social_messages',
  ]
  if (JSON.stringify(tables.rows.map(row => row.tablename)) !== JSON.stringify(expectedTables)) {
    throw new Error('Messaging migration did not create the exact three-table schema')
  }

  const sequenceType = await pool.query(
    "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='social_messages' AND column_name='sequence'",
  )
  if (sequenceType.rows[0]?.data_type !== 'bigint') throw new Error('Message sequence must be BIGINT')

  const uniqueConstraints = await pool.query(
    "SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid='public.social_messages'::regclass AND contype='u' ORDER BY conname",
  )
  if (uniqueConstraints.rows.length !== 2) throw new Error('Message sequence and sender/client idempotency uniqueness must both be enforced')

  const indexes = await pool.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('ix_social_conversations_updated','ix_social_conversation_memberships_user') ORDER BY indexname",
  )
  if (indexes.rows.length !== 2) throw new Error('Conversation and membership lookup indexes are missing')

  const foreignKeys = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND conrelid IN ('public.social_conversations'::regclass,'public.social_conversation_memberships'::regclass,'public.social_messages'::regclass)",
  )
  if (Number(foreignKeys.rows[0]?.count) !== 0) throw new Error('Messaging schema must not introduce cross-domain foreign keys')

  const rows = await pool.query(
    'SELECT (SELECT count(*) FROM social_conversations) + (SELECT count(*) FROM social_conversation_memberships) + (SELECT count(*) FROM social_messages) AS count',
  )
  if (Number(rows.rows[0]?.count) !== 0) throw new Error('Schema rehearsal must not import business rows')

  console.log('W05_MESSAGING_PHASE1_POSTGRES18_REHEARSAL_PASS')
} finally {
  await pool.end()
}
