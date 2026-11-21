import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`identity_id\` text;`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_identity_id_idx\` ON \`users\` (\`identity_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`users_identity_id_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`identity_id\`;`)
}
