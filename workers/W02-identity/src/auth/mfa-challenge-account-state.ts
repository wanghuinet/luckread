export async function isActiveMfaSubject(db: D1Database, userId: string): Promise<boolean> {
  if (typeof userId !== 'string' || userId.length < 1 || userId.length > 128) {
    throw new TypeError('invalid MFA challenge subject')
  }
  const row = await db.prepare(
    'SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
  ).bind(userId).first<{ accountState: string | null }>()
  return row?.accountState === 'ACTIVE'
}
