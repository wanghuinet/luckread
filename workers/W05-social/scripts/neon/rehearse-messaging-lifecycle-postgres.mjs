import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'

const connectionString = process.env.MESSAGING_TEST_DATABASE_URL
if (!connectionString) throw new Error('MESSAGING_TEST_DATABASE_URL is required')
const pool = new Pool({ connectionString, max: 2 })
try {
  const migrationPaths = [
    '0001_w05_d1_02_social_schema.sql',
    '0002_w05_messaging_core.sql',
    '0003_w05_message_requests.sql',
    '0004_w05_messaging_attachments.sql',
    '0005_w05_messaging_lifecycle.sql',
    '0006_w05_messaging_groups.sql',
    '0007_w05_messaging_transactional_outbox.sql',
  ]
  for (const filename of migrationPaths) {
    const sql = readFileSync(resolve('workers/W05-social/src/neon-postgres-migrations', filename), 'utf8')
    await pool.query(sql)
  }

  const tables = await pool.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  )
  const tableNames = tables.rows.map(row => row.tablename)
  const expected = [
    'social_conversation_memberships',
    'social_conversations',
    'social_messages',
    'social_message_requests',
    'social_message_request_audit',
    'social_messaging_outbox',
  ]
  if (tableNames.length !== 25 || expected.some(name => !tableNames.includes(name))) {
    throw new Error('W05 baseline plus all messaging migrations must produce 25 tables including messaging and request tables')
  }

  const columns = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='social_messages'",
  )
  const columnNames = new Set(columns.rows.map(row => row.column_name))
  for (const name of ['attachments', 'edited_at', 'recalled_at']) {
    if (!columnNames.has(name)) throw new Error('Missing messaging lifecycle column: ' + name)
  }

  const conversationColumns = await pool.query(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='social_conversations'",
  )
  const conversationColumnMap = new Map(conversationColumns.rows.map(row => [row.column_name, row.is_nullable]))
  if (conversationColumnMap.get('direct_pair_key') !== 'YES' || !conversationColumnMap.has('group_name')) {
    throw new Error('Group migration must allow nullable direct_pair_key and add group_name')
  }

  const groupConstraints = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE conrelid='public.social_conversations'::regclass AND conname IN ('social_conversations_conversation_type_check','social_conversations_group_name_check') ORDER BY conname",
  )
  if (groupConstraints.rows.length !== 2) throw new Error('Group type and group-name constraints must both exist')
  const groupDefinitions = groupConstraints.rows.map(row => String(row.definition))
  if (!groupDefinitions.some(definition => definition.includes('direct') && definition.includes('group')) ||
      !groupDefinitions.some(definition => definition.includes('group_name') && definition.includes('80'))) {
    throw new Error('Group constraints must restrict types and enforce a trimmed 1-80 character name')
  }

  const constraints = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE conrelid='public.social_messages'::regclass AND conname='social_messages_body_or_attachments_check'",
  )
  const definition = String(constraints.rows[0]?.definition ?? '')
  if (!definition.includes('recalled_at IS NOT NULL')) throw new Error('Recalled-message tombstones must satisfy the message body constraint')

  const indexes = await pool.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('ix_social_conversations_updated','ix_social_conversation_memberships_user','ix_social_messages_attachments_gin','ux_social_conversations_direct_pair_key','ix_social_conversation_memberships_active') ORDER BY indexname",
  )
  if (indexes.rows.length !== 5) throw new Error('Conversation, membership, direct-pair, or private attachment lookup index is missing')

  const directPairIndex = await pool.query(
    "SELECT indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname='ux_social_conversations_direct_pair_key'",
  )
  if (!String(directPairIndex.rows[0]?.indexdef ?? '').includes("conversation_type = 'direct'")) {
    throw new Error('Direct-pair uniqueness must apply only to direct conversations')
  }

  const sequenceType = await pool.query(
    "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='social_messages' AND column_name='sequence'",
  )
  if (sequenceType.rows[0]?.data_type !== 'bigint') throw new Error('Message sequence must be BIGINT')

  const triggers = await pool.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid IN ('social_messages'::regclass, 'social_conversation_memberships'::regclass) AND NOT tgisinternal ORDER BY tgname",
  )
  if (triggers.rows.length !== 2) throw new Error('Transactional message and read-receipt outbox triggers are missing')

  const fixtureClient = await pool.connect()
  try {
    await fixtureClient.query('BEGIN')
    await fixtureClient.query(
      "INSERT INTO social_conversations (conversation_id, conversation_type, direct_pair_key, created_by_user_id, last_sequence, created_at, updated_at) VALUES ('outbox-conversation', 'direct', 'outbox-a:outbox-b', 'outbox-a', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
    )
    await fixtureClient.query(
      "INSERT INTO social_conversation_memberships (conversation_id, user_id, member_role, joined_at, last_read_sequence) VALUES ('outbox-conversation', 'outbox-a', 'owner', CURRENT_TIMESTAMP, 0), ('outbox-conversation', 'outbox-b', 'member', CURRENT_TIMESTAMP, 0)",
    )
    await fixtureClient.query(
      "INSERT INTO social_messages (message_id, conversation_id, sender_user_id, sequence, client_message_id, body, attachments, created_at) VALUES ('outbox-message', 'outbox-conversation', 'outbox-a', 1, 'outbox-client', 'hello', '[]'::jsonb, CURRENT_TIMESTAMP)",
    )
    await fixtureClient.query("UPDATE social_messages SET body = 'edited', edited_at = CURRENT_TIMESTAMP WHERE message_id = 'outbox-message'")
    await fixtureClient.query("UPDATE social_messages SET body = '', attachments = '[]'::jsonb, recalled_at = CURRENT_TIMESTAMP WHERE message_id = 'outbox-message'")
    await fixtureClient.query("UPDATE social_conversation_memberships SET last_read_sequence = 1 WHERE conversation_id = 'outbox-conversation' AND user_id = 'outbox-b'")
    const events = await fixtureClient.query(
      "SELECT event_type, count(*)::int AS count FROM social_messaging_outbox WHERE conversation_id = 'outbox-conversation' GROUP BY event_type",
    )
    const eventCounts = Object.fromEntries(events.rows.map(row => [row.event_type, Number(row.count)]))
    for (const type of ['message.created', 'message.edited', 'message.recalled', 'conversation.read']) {
      if (eventCounts[type] !== 1) throw new Error('Transactional outbox event missing or duplicated: ' + type)
    }
  } finally {
    try { await fixtureClient.query('ROLLBACK') } finally { fixtureClient.release() }
  }

  const rows = await pool.query(
    'SELECT (SELECT count(*) FROM social_conversations) + (SELECT count(*) FROM social_conversation_memberships) + (SELECT count(*) FROM social_messages) + (SELECT count(*) FROM social_message_requests) + (SELECT count(*) FROM social_message_request_audit) + (SELECT count(*) FROM social_messaging_outbox) AS count',
  )
  if (Number(rows.rows[0]?.count) !== 0) throw new Error('Schema rehearsal must not import business rows')

  console.log('W05_MESSAGING_LIFECYCLE_POSTGRES18_REHEARSAL_PASS ' + JSON.stringify({
    tables: tableNames.length,
    messagingTables: expected.length,
    migrations: migrationPaths,
    groupSchema: true,
    lifecycleColumns: ['attachments', 'edited_at', 'recalled_at'],
    recalledTombstoneConstraint: true,
    transactionalOutboxTriggers: triggers.rows.length,
    businessRows: 0,
  }))
} finally {
  await pool.end()
}
