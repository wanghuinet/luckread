export type RegistrationRollbackCommand = {
  userId: string
  email: string
  username: string
}

export type RegistrationRollbackResult = {
  rolledBack: true
}

export type RegistrationRollbackErrorCode = 'INVALID_INPUT' | 'PRECONDITION_FAILED'

export class RegistrationRollbackStoreError extends Error {
  constructor(
    readonly code: RegistrationRollbackErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RegistrationRollbackStoreError'
  }
}

export interface RegistrationRollbackStore {
  rollback(command: RegistrationRollbackCommand): Promise<RegistrationRollbackResult>
}

function normalizeCommand(command: RegistrationRollbackCommand): RegistrationRollbackCommand {
  if (
    !command ||
    typeof command.userId !== 'string' ||
    command.userId.length < 1 ||
    command.userId.length > 128 ||
    typeof command.email !== 'string' ||
    command.email.trim().length === 0 ||
    typeof command.username !== 'string' ||
    command.username.trim().length === 0
  ) {
    throw new RegistrationRollbackStoreError('INVALID_INPUT', 'invalid registration rollback command')
  }
  return {
    userId: command.userId,
    email: command.email.trim().toLowerCase(),
    username: command.username.trim(),
  }
}

/**
 * Production adapter. Preserve the existing registration rollback checks
 * and D1 batch boundary; D1-01 remains the W02 production authority.
 */
export function createD1RegistrationRollbackStore(db: D1Database): RegistrationRollbackStore {
  return {
    async rollback(rawCommand) {
      const command = normalizeCommand(rawCommand)
      const row = await db.prepare(
        'SELECT id, email, username, account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
      ).bind(command.userId).first<{
        id: string
        email: string
        username: string | null
        accountState: string
      }>()

      // An absent pending registration is an idempotent rollback success.
      if (!row) return { rolledBack: true }

      if (
        row.email !== command.email ||
        String(row.username ?? '') !== command.username ||
        row.accountState !== 'PENDING_VERIFICATION'
      ) {
        throw new RegistrationRollbackStoreError(
          'PRECONDITION_FAILED',
          'registration rollback precondition failed',
        )
      }

      const activeSession = await db.prepare(
        'SELECT 1 AS present FROM "session" WHERE user_id = ? LIMIT 1',
      ).bind(command.userId).first<{ present: number }>()

      if (activeSession) {
        throw new RegistrationRollbackStoreError(
          'PRECONDITION_FAILED',
          'registration rollback cannot remove an active session',
        )
      }

      await db.batch([
        db.prepare('DELETE FROM role_assignments WHERE subject_id = ?').bind(command.userId),
        db.prepare('DELETE FROM "verification" WHERE identifier = ?').bind(command.email),
        db.prepare('DELETE FROM "account" WHERE user_id = ?').bind(command.userId),
        db.prepare('DELETE FROM "user" WHERE id = ? AND account_state = ?')
          .bind(command.userId, 'PENDING_VERIFICATION'),
      ])

      return { rolledBack: true }
    },
  }
}
