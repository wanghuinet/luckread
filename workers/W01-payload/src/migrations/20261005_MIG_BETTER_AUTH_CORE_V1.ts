import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`users\` ADD \`email_verified\` integer NOT NULL DEFAULT 0;`)

  await db.run(sql`CREATE INDEX \`users_email_verified_idx\` ON \`users\` (\`email_verified\`);`)

  await db.run(sql`CREATE TABLE \`auth_sessions\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`user_id\` text NOT NULL,
    \`token\` text NOT NULL,
    \`expires_at\` text NOT NULL,
    \`ip_address\` text,
    \`user_agent\` text,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)

  await db.run(sql`CREATE UNIQUE INDEX \`auth_sessions_token_uq\` ON \`auth_sessions\` (\`token\`);`)
  await db.run(sql`CREATE INDEX \`auth_sessions_user_id_idx\` ON \`auth_sessions\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`auth_sessions_expires_at_idx\` ON \`auth_sessions\` (\`expires_at\`);`)

  await db.run(sql`CREATE TABLE \`auth_accounts\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`user_id\` text NOT NULL,
    \`account_id\` text NOT NULL,
    \`provider_id\` text NOT NULL,
    \`access_token\` text,
    \`refresh_token\` text,
    \`access_token_expires_at\` text,
    \`refresh_token_expires_at\` text,
    \`scope\` text,
    \`id_token\` text,
    \`password\` text,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`)

  await db.run(sql`CREATE UNIQUE INDEX \`auth_accounts_provider_account_uq\` ON \`auth_accounts\` (\`provider_id\`, \`account_id\`);`)
  await db.run(sql`CREATE INDEX \`auth_accounts_user_id_idx\` ON \`auth_accounts\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`auth_accounts_provider_id_idx\` ON \`auth_accounts\` (\`provider_id\`);`)

  await db.run(sql`CREATE TABLE \`auth_verifications\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`identifier\` text NOT NULL,
    \`value\` text NOT NULL,
    \`expires_at\` text NOT NULL,
    \`created_at\` text NOT NULL,
    \`updated_at\` text NOT NULL
  );`)

  await db.run(sql`CREATE INDEX \`auth_verifications_identifier_idx\` ON \`auth_verifications\` (\`identifier\`);`)
  await db.run(sql`CREATE INDEX \`auth_verifications_expires_at_idx\` ON \`auth_verifications\` (\`expires_at\`);`)

  await db.run(sql`
    INSERT INTO \`auth_accounts\` (
      id,
      user_id,
      account_id,
      provider_id,
      password,
      created_at,
      updated_at
    )
    SELECT
      lower(hex(randomblob(16))),
      CAST(id AS TEXT),
      CAST(id AS TEXT),
      'credential',
      CASE
        WHEN hash LIKE 'pbkdf2-sha256-v1:%' AND salt IS NOT NULL
          THEN 'pbkdf2-sha256-v1:' || salt || ':' || substr(hash, length('pbkdf2-sha256-v1:') + 1)
        WHEN hash IS NOT NULL AND salt IS NOT NULL
          THEN 'pbkdf2-sha256-legacy:' || salt || ':' || hash
        ELSE NULL
      END,
      created_at,
      updated_at
    FROM users
    WHERE hash IS NOT NULL AND salt IS NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`auth_verifications\`;`)
  await db.run(sql`DROP TABLE \`auth_accounts\`;`)
  await db.run(sql`DROP TABLE \`auth_sessions\`;`)
  await db.run(sql`DROP INDEX \`users_email_verified_idx\`;`)
  await db.run(sql`ALTER TABLE \`users\` DROP COLUMN \`email_verified\`;`)
}
