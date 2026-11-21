import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`username\` text NOT NULL;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`display_name\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`bio\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`avatar\` text;`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`locale\` text DEFAULT 'en-US';`)
  await db.run(sql`ALTER TABLE \`users\` ADD \`timezone\` text DEFAULT 'UTC';`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_username_idx\` ON \`users\` (\`username\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`users_username_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`username\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`display_name\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`bio\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`avatar\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`locale\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`timezone\`;`)
}
