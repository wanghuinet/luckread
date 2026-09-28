import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

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

  await db.run(sql`CREATE TABLE \`consents\` (
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
  await db.run(sql`CREATE INDEX \`consents_actor_subject_id_idx\` ON \`consents\` (\`actor_subject_id\`);`)
  await db.run(sql`CREATE INDEX \`consents_owner_subject_id_idx\` ON \`consents\` (\`owner_subject_id\`);`)
  await db.run(sql`CREATE INDEX \`consents_resource_id_idx\` ON \`consents\` (\`resource_id\`);`)
  await db.run(sql`CREATE INDEX \`consents_resource_type_idx\` ON \`consents\` (\`resource_type\`);`)
  await db.run(sql`CREATE INDEX \`consents_purpose_idx\` ON \`consents\` (\`purpose\`);`)
  await db.run(sql`CREATE INDEX \`consents_state_idx\` ON \`consents\` (\`state\`);`)
  await db.run(sql`CREATE INDEX \`consents_policy_version_idx\` ON \`consents\` (\`policy_version\`);`)
  await db.run(sql`CREATE INDEX \`consents_legal_basis_idx\` ON \`consents\` (\`legal_basis\`);`)
  await db.run(sql`CREATE INDEX \`consents_withdrawn_at_idx\` ON \`consents\` (\`withdrawn_at\`);`)
  await db.run(sql`CREATE INDEX \`consents_retention_class_idx\` ON \`consents\` (\`retention_class\`);`)
  await db.run(sql`CREATE INDEX \`consents_retention_until_idx\` ON \`consents\` (\`retention_until\`);`)
  await db.run(sql`CREATE INDEX \`consents_source_authority_idx\` ON \`consents\` (\`source_authority\`);`)
  await db.run(sql`CREATE INDEX \`consents_legal_hold_ref_idx\` ON \`consents\` (\`legal_hold_ref\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`auth_registration_envelopes\`;`)
  await db.run(sql`DROP TABLE \`consents\`;`)
}