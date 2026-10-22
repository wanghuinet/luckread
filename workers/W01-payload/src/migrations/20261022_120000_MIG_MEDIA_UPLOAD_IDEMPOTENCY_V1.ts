import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`media\` ADD \`upload_idempotency_key\` text;`)
  await db.run(sql`ALTER TABLE \`media\` ADD \`upload_fingerprint\` text;`)
  // Existing media rows have NULL keys, so the unique index permits them while
  // ensuring that one logical upload key can create at most one media record.
  await db.run(sql`CREATE UNIQUE INDEX \`media_upload_idempotency_key_idx\` ON \`media\` (\`upload_idempotency_key\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`media_upload_idempotency_key_idx\`;`)
  await db.run(sql`ALTER TABLE \`media\` DROP COLUMN \`upload_fingerprint\`;`)
  await db.run(sql`ALTER TABLE \`media\` DROP COLUMN \`upload_idempotency_key\`;`)
}
