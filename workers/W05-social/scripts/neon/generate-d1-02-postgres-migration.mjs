import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()
const inventoryPath = 'contracts/database/neon-d1-02-schema-sources.v1.json'
const socialContractPath = 'contracts/persistence/SOCIAL-001-follow-relationship-persistence-contract.v1.json'
const templatePath = 'workers/W05-social/scripts/neon/templates/d1-02-social-postgres.sql'
const outputPath = 'workers/W05-social/src/neon-postgres-migrations/0001_w05_d1_02_social_schema.sql'

const fail = (message) => { throw new Error('W05 D1-02 PostgreSQL schema drift: ' + message) }
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))

export function buildW05PostgresMigration({ inventory, socialContract, readSource, template }) {
  if (inventory?.target?.domainId !== 'D1-02' ||
      inventory?.target?.databaseName !== 'luckreadpro' ||
      inventory?.target?.databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c' ||
      inventory?.target?.postgresMajor !== 18 ||
      inventory?.target?.businessDataImport !== false ||
      inventory?.target?.productionCutoverAuthorized !== false) {
    fail('D1-02 target must remain luckreadpro / PostgreSQL 18 / empty-schema only')
  }

  const owner = inventory.owners?.find((item) => item.worker === 'W05')
  if (!owner || owner.migrationDirectory !== 'workers/W05-social/migrations' ||
      !Array.isArray(owner.sqlMigrations) || owner.sqlMigrations.length !== 15) {
    fail('W05 must own exactly the frozen fifteen D1-02 source migrations')
  }

  const includedBindings = owner.physicalBindings?.filter((item) => item.included === true) ?? []
  const excludedGovernanceBindings = owner.physicalBindings?.filter(
    (item) => item.binding === 'D1_03' && item.logicalDomain === 'D1-03' && item.included === false
  ) ?? []
  if (includedBindings.length !== 1 ||
      includedBindings[0].binding !== 'DB' ||
      includedBindings[0].logicalDomain !== 'D1-02' ||
      includedBindings[0].databaseName !== 'luckreadpro' ||
      includedBindings[0].databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c' ||
      excludedGovernanceBindings.length !== 1 ||
      excludedGovernanceBindings[0].databaseName !== 'secondary') {
    fail('W05 DB must map only to D1-02; W05 D1_03 governance binding must remain excluded')
  }

  if (socialContract?.authoritativeDomain !== 'D1-02' ||
      socialContract?.primaryWorker !== 'W05' ||
      socialContract?.physicalResource?.databaseName !== 'luckreadpro' ||
      socialContract?.physicalResource?.databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c') {
    fail('SOCIAL-001 authority/physical resource contract drift')
  }

  const actualFiles = readdirSync(path.join(root, owner.migrationDirectory))
    .filter((file) => file.endsWith('.sql')).sort()
  const expectedFiles = [...owner.sqlMigrations].sort()
  const missing = expectedFiles.filter((file) => !actualFiles.includes(file))
  const unexpected = actualFiles.filter((file) => !expectedFiles.includes(file))
  if (missing.length || unexpected.length) {
    fail('W05 migration source drift: missing=[' + missing.join(', ') +
      '], unexpected=[' + unexpected.join(', ') + ']')
  }

  const sourceRows = []
  for (const fileName of owner.sqlMigrations) {
    const relativePath = path.posix.join(owner.migrationDirectory, fileName)
    const content = readSource(relativePath)
    if (typeof content !== 'string') fail('Missing source migration: ' + relativePath)
    sourceRows.push({ path: relativePath, sha256: createHash('sha256').update(content).digest('hex') })
  }

  const sql = template.trim()
  if (!sql.startsWith('-- W05 / D1-02 PostgreSQL 18 schema-only bootstrap.') ||
      !sql.includes('BEGIN;') || !sql.endsWith('COMMIT;')) {
    fail('native PostgreSQL template must be transaction-wrapped and explicitly W05/D1-02 scoped')
  }

  const expectedTables = [
    'social_follow_relationships', 'interaction_likes', 'social_comments',
    'interaction_favorites', 'social_share_links', 'social_user_interactions',
    'social_topics', 'social_target_topics', 'social_mentions', 'social_notifications',
    'social_notification_preferences', 'social_reposts', 'social_profile_pins',
    'social_polls', 'social_poll_options', 'social_poll_votes',
    'social_content_reply_policies', 'social_notification_push_outbox',
    'social_notification_push_deliveries',
  ].sort()
  const actualTables = [...sql.matchAll(/^CREATE TABLE ([a-z_][a-z0-9_]*)/gim)]
    .map((match) => match[1]).sort()
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    fail('native schema must create exactly the nineteen W05-owned D1-02 tables')
  }

  const expectedIndexes = [
    'uq_social_follow_follower_target', 'ix_social_follow_follower_created',
    'ix_social_follow_target_created', 'uq_interaction_like_actor_target',
    'ix_interaction_like_target_created', 'ix_interaction_like_actor_created',
    'ix_social_comments_content_state_created', 'ix_social_comments_parent_created',
    'ix_social_comments_author_created', 'uq_interaction_favorite_actor_target',
    'ix_interaction_favorite_actor_created', 'ix_interaction_favorite_target_created',
    'ix_social_share_links_content_created', 'ix_social_share_links_actor_created',
    'ix_social_user_interactions_actor_type_created',
    'ix_social_user_interactions_target_type_created', 'ix_social_topics_status_updated',
    'ix_social_target_topics_topic_created', 'ix_social_target_topics_target',
    'ix_social_target_topics_content_topic_target', 'ix_social_mentions_recipient_created',
    'ix_social_mentions_target_created', 'ix_social_notifications_recipient_created',
    'ix_social_notifications_recipient_unread', 'ix_social_reposts_content_created',
    'ix_social_reposts_actor_created', 'ix_social_profile_pins_content',
    'ix_social_polls_owner_updated', 'ix_social_poll_options_poll_position',
    'ix_social_poll_votes_option_created', 'ix_social_content_reply_policies_owner',
    'ix_social_notification_push_outbox_status_created',
    'ix_social_notification_push_deliveries_due',
    'ix_social_notification_push_deliveries_endpoint', 'uq_social_notification_push_ticket',
  ]
  const actualIndexes = [...sql.matchAll(/^CREATE (?:UNIQUE )?INDEX ([a-z_][a-z0-9_]*)/gim)]
    .map((match) => match[1])
  if (JSON.stringify([...actualIndexes].sort()) !== JSON.stringify([...expectedIndexes].sort())) {
    fail('native schema index set does not match the frozen W05 D1-02 source migration set')
  }

  const expectedTriggers = ['trg_social_notifications_push_outbox_insert']
  const actualTriggers = [...sql.matchAll(/^CREATE TRIGGER ([a-z_][a-z0-9_]*)/gim)].map((match) => match[1])
  if (JSON.stringify(actualTriggers) !== JSON.stringify(expectedTriggers)) {
    fail('native schema must preserve the single atomic notification-to-push-outbox trigger')
  }

  const ddlStatements = sql.replace(/^\s*--.*$/gm, '')
  if (/\bFOREIGN\s+KEY\b|\bREFERENCES\s+[a-z_]/i.test(ddlStatements)) {
    fail('W05 identifiers remain opaque; no cross-domain or implicit foreign keys are admitted')
  }
  if (/\b(?:PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB|json_valid|json_extract|json_object|randomblob)\b|\bINSERT\s+OR\s+IGNORE\b/i.test(ddlStatements)) {
    fail('PostgreSQL template contains SQLite-only syntax')
  }
  if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?notification_push_endpoints\b/i.test(ddlStatements) ||
      /bda1d247-a371-4244-91ae-aef96034db7f|notification_push_endpoints|D1_03|secondary/i.test(ddlStatements)) {
    fail('D1-03/W09 push endpoint state must not be created or imported in D1-02')
  }
  if (!/payload_json TEXT NOT NULL DEFAULT '\{\}'/.test(sql) ||
      !/mentioned_user_ids_json TEXT NOT NULL DEFAULT '\[\]'/.test(sql)) {
    fail('JSON payloads and reply-audience IDs must remain serialized TEXT fields')
  }
  if (!/duration_minutes INTEGER NOT NULL DEFAULT 1440/.test(sql) ||
      !/ON CONFLICT \(notification_id\) DO NOTHING/.test(sql)) {
    fail('poll minute migration or atomic push-outbox conflict semantics are missing')
  }
  if (!/created_at TIMESTAMPTZ NOT NULL/.test(sql) ||
      !/updated_at TIMESTAMPTZ NOT NULL/.test(sql) ||
      !/next_attempt_at TIMESTAMPTZ NOT NULL/.test(sql)) {
    fail('ISO-8601 timestamp fields must map consistently to TIMESTAMPTZ')
  }

  const header = [
    '-- GENERATED FILE. Do not hand-edit.',
    '-- Regenerate with workers/W05-social/scripts/neon/generate-d1-02-postgres-migration.mjs.',
    '-- Template: workers/W05-social/scripts/neon/templates/d1-02-social-postgres.sql.',
    '-- Source authority: W05 / D1-02; Cloudflare D1 remains the current runtime authority.',
    ''
  ].join('\n')

  return {
    artifact: header + sql + '\n',
    sourceReport: {
      reportType: 'W05_D1_02_POSTGRES_SCHEMA_SOURCE_HASHES',
      sourceOwner: 'W05',
      targetDatabase: 'luckreadpro',
      postgresMajor: 18,
      migrationCount: sourceRows.length,
      sourceMigrations: sourceRows,
      safety: {
        neonConnectionAttempted: false,
        remoteDdlExecuted: false,
        cloudflareD1Touched: false,
        d1_03SchemaImported: false,
        businessDataImported: false,
        runtimeChanged: false,
        productionCutoverAuthorized: false,
      }
    }
  }
}

function readSource(relativePath) {
  try { return readFileSync(path.join(root, relativePath), 'utf8') } catch { return null }
}

function run() {
  const inventory = readJson(inventoryPath)
  const socialContract = readJson(socialContractPath)
  const template = readFileSync(path.join(root, templatePath), 'utf8')
  const { artifact, sourceReport } = buildW05PostgresMigration({ inventory, socialContract, readSource, template })
  mkdirSync(path.dirname(path.join(root, outputPath)), { recursive: true })
  writeFileSync(path.join(root, outputPath), artifact)
  const reportIndex = process.argv.indexOf('--report')
  if (reportIndex >= 0) {
    const reportPath = process.argv[reportIndex + 1]
    if (!reportPath) fail('--report requires an output path')
    mkdirSync(path.dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(sourceReport, null, 2) + '\n')
  }
  console.log('W05_D1_02_POSTGRES_MIGRATION_GENERATION_PASS')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
