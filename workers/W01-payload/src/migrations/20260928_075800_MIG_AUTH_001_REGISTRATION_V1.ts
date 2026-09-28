import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`auth_registration_envelopes\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`idempotency_key\` text NOT NULL,
  \`active_key\` text,
  \`scope\` text NOT NULL,
  \`endpoint\` text NOT NULL,
  \`payload_hash\` text NOT NULL,
  \`state\` text NOT NULL,
  \`response_digest\` text,
  \`committed_response\` text NOT NULL,
  \`expires_at\` text NOT NULL,
  \`consent_record_id\` text NOT NULL,
  \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );`)
  await db.run(sql`CREATE INDEX \`auth_registration_envelopes_idempotency_key_idx\` ON \`auth_registration_envelopes\` (\`idempotency_key\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`auth_registration_envelopes_active_key_idx\` ON \`auth_registration_envelopes\` (\`active_key\`);`)
  await db.run(sql`CREATE INDEX \`auth_registration_envelopes_scope_endpoint_idx\` ON \`auth_registration_envelopes\` (\`scope\`, \`endpoint\`);`)
  await db.run(sql`CREATE INDEX \`auth_registration_envelopes_payload_hash_idx\` ON \`auth_registration_envelopes\` (\`payload_hash\`);`)
  await db.run(sql`CREATE INDEX \`auth_registration_envelopes_state_idx\` ON \`auth_registration_envelopes\` (\`state\`);`)
  await db.run(sql`CREATE INDEX \`auth_registration_envelopes_expires_at_idx\` ON \`auth_registration_envelopes\` (\`expires_at\`);`)
  await db.run(sql`CREATE INDEX \`auth_registration_envelopes_consent_record_id_idx\` ON \`auth_registration_envelopes\` (\`consent_record_id\`);`)

  await db.run(sql`CREATE TABLE \`consent_records\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`actor_subject_id\` text NOT NULL,
  \`owner_subject_id\` text NOT NULL,
  \`resource_id\` text NOT NULL,
  \`resource_type\` text NOT NULL,
  \`purpose\` text NOT NULL,
  \`state\` text NOT NULL,
  \`policy_version\` text NOT NULL,
  \`legal_basis\` text NOT NULL,
  \`withdrawn_at\` text,
  \`retention_class\` text NOT NULL,
  \`retention_until\` text NOT NULL,
  \`source_authority\` text NOT NULL,
  \`legal_hold_ref\` text,
  \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );`)
  await db.run(sql`CREATE INDEX \`consent_records_actor_subject_id_idx\` ON \`consent_records\` (\`actor_subject_id\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_owner_subject_id_idx\` ON \`consent_records\` (\`owner_subject_id\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_resource_id_idx\` ON \`consent_records\` (\`resource_id\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_resource_type_idx\` ON \`consent_records\` (\`resource_type\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_purpose_idx\` ON \`consent_records\` (\`purpose\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_state_idx\` ON \`consent_records\` (\`state\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_policy_version_idx\` ON \`consent_records\` (\`policy_version\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_withdrawn_at_idx\` ON \`consent_records\` (\`withdrawn_at\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_retention_class_idx\` ON \`consent_records\` (\`retention_class\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_retention_until_idx\` ON \`consent_records\` (\`retention_until\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_source_authority_idx\` ON \`consent_records\` (\`source_authority\`);`)
  await db.run(sql`CREATE INDEX \`consent_records_legal_hold_ref_idx\` ON \`consent_records\` (\`legal_hold_ref\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`auth_registration_envelopes\`;`)
  await db.run(sql`DROP TABLE \`consent_records\`;`)
}