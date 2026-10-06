import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD COLUMN \`identity_user_id\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_identity_user_id_idx\` ON \`users\` (\`identity_user_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX IF EXISTS \`users_identity_user_id_idx\`;`)
  // SQLite/D1 does not support dropping a column in all admitted runtime paths.
  // Keep rollback non-destructive rather than rebuilding the Payload users table.
}
