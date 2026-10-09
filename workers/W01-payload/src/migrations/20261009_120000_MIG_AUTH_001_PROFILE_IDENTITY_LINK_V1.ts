import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

/**
 * Link the W01 profile projection to the authoritative W02 Better Auth user.
 * The identity is externally owned, so this is a unique text key, not a D1 FK.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`identity_id\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_identity_id_idx\` ON \`users\` (\`identity_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`users_identity_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`identity_id\`;`)
}
