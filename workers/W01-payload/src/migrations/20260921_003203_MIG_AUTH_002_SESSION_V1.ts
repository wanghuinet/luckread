import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`auth_session_state\` (
  \`session_id\` text PRIMARY KEY NOT NULL,
  \`user_id\` text NOT NULL,
  \`device_id\` text NOT NULL,
  \`token_version\` integer NOT NULL,
  \`refresh_credential_hash\` text NOT NULL,
  \`revoked_at\` text,
  \`last_seen_at\` text
);
`)
  await db.run(sql`CREATE INDEX \`auth_session_state_user_id_idx\` ON \`auth_session_state\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`auth_session_state_device_id_idx\` ON \`auth_session_state\` (\`device_id\`);`)
  await db.run(sql`CREATE INDEX \`auth_session_state_token_version_idx\` ON \`auth_session_state\` (\`token_version\`);`)
  await db.run(sql`CREATE INDEX \`auth_session_state_revoked_at_idx\` ON \`auth_session_state\` (\`revoked_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`auth_session_state\`;`)
}
