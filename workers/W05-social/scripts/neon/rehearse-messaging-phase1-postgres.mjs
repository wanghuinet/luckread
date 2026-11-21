import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'

const connectionString = process.env.MESSAGING_TEST_DATABASE_URL
if (!connectionString) throw new Error('MESSAGING_TEST_DATABASE_URL is required')
const pool = new Pool({ connectionString, max: 2 })
try {
  // Rehearse against the real W05 D1-02 baseline, then apply the additive messaging migration.
  const baseline = readFileSync(resolve('workers/W05-social/src/neon-postgres-migrations/0001_w05_d1_02_social_schema.sql'), 'utf8')
  await pool.query(baseline)
  const migration = readFileSync(resolve('workers/W05-social/src/neon-postgres-migrations/0002_w05_messaging_core.sql'), 'utf8')
  await pool.query(migration)

  const tables = await pool.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  )
  const tableNames = tables.rows.map(row => row.tablename)
  const expectedMessagingTables = [
    'social_conversation_memberships',
    'social_conversations',
    'social_messages',
  ]
  if (tableNames.length !== 22 || expectedMessagingTables.some(name => !tableNames.includes(name))) {
    throw new Error('W05 baseline plus messaging migration must produce 22 tables including all three messaging tables')
  }
  if (!tableNames.includes('social_user_interactions')) {
    throw new Error('Messaging block enforcement must share the authoritative W05 social interaction table')
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
    "SELECT count(*)::integer AS count FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND conrelid IN ('public.social_conversation_memberships'::regclass,'public.social_messages'::regclass)",
  )
  if (Number(foreignKeys.rows[0]?.count) !== 2) throw new Error('Memberships and messages must reference their owning conversation')
  const crossDomainForeignKeys = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND conrelid IN ('public.social_conversation_memberships'::regclass,'public.social_messages'::regclass) AND pg_get_constraintdef(oid) NOT LIKE '%REFERENCES social_conversations%'",
  )
  if (Number(crossDomainForeignKeys.rows[0]?.count) !== 0) throw new Error('Messaging schema must not introduce cross-domain foreign keys')

  const rows = await pool.query(
    'SELECT (SELECT count(*) FROM social_conversations) + (SELECT count(*) FROM social_conversation_memberships) + (SELECT count(*) FROM social_messages) AS count',
  )
  if (Number(rows.rows[0]?.count) !== 0) throw new Error('Schema rehearsal must not import business rows')

  const baselineCounts = await pool.query(
    'SELECT (SELECT count(*) FROM social_user_interactions) AS interactions, (SELECT count(*) FROM social_notifications) AS notifications',
  )
  if (Number(baselineCounts.rows[0]?.interactions) !== 0 || Number(baselineCounts.rows[0]?.notifications) !== 0) {
    throw new Error('W05 baseline fixtures must remain empty')
  }

  console.log('W05_MESSAGING_PHASE1_POSTGRES18_REHEARSAL_PASS ' + JSON.stringify({ tables: tableNames.length, messagingTables: expectedMessagingTables.length, baselineBlockTable: true, businessRows: 0 }))
} finally {
  await pool.end()
}
