import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-d1-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`DROP TABLE IF EXISTS \`auth_session_state\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // The retired session extension must not be recreated by rollback. Better Auth
  // owns the canonical session table and there is no valid restore target.
  await db.run(sql`SELECT 1;`)
}
