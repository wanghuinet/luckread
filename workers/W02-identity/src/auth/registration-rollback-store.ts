export type RegistrationRollbackCommand = {
  userId: string
  email: string
  username: string
}

export type RegistrationRollbackResult = {
  rolledBack: true
}

export type RegistrationIdentityConfirmationCommand = {
  userId: string
  email: string
}

export type RegistrationIdentity = {
  id: string
  email: string
  username: string | null
}

export type RegistrationIdentityConfirmation = {
  identityById: RegistrationIdentity | null
  identityByEmailId: string | null
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
  confirmIdentity(command: RegistrationIdentityConfirmationCommand): Promise<RegistrationIdentityConfirmation>
  rollback(command: RegistrationRollbackCommand): Promise<RegistrationRollbackResult>
}

function normalizeIdentityConfirmation(
  command: RegistrationIdentityConfirmationCommand,
): RegistrationIdentityConfirmationCommand {
  if (
    !command ||
    typeof command.userId !== 'string' ||
    command.userId.length < 1 ||
    command.userId.length > 128 ||
    typeof command.email !== 'string' ||
    command.email.trim().length === 0 ||
    command.email.trim().length > 254
  ) {
    throw new RegistrationRollbackStoreError('INVALID_INPUT', 'invalid registration identity confirmation')
  }
  return {
    userId: command.userId,
    email: command.email.trim().toLowerCase(),
  }
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
 * Deprecated D1 fixture retained for isolated legacy adapter tests only.
 * Production W02 uses the Neon PostgreSQL registration rollback Store.
 */
/**
 * @deprecated-next-version
 * Reason: Legacy Cloudflare D1 implementation retained only for isolated unit tests or the explicit schema/test fixture.
 * Replacement: PostgreSQL registration rollback Store in src/neon/registration-rollback-postgres.ts.
 * Removal: Next release.
 * Condition: Registration rollback tests use PostgreSQL/in-memory Store fixtures and all W02 production callers use the Neon runtime.
 */
export function createD1RegistrationRollbackStore(db: D1Database): RegistrationRollbackStore {
  return {
    async confirmIdentity(rawCommand) {
      const command = normalizeIdentityConfirmation(rawCommand)
      const identityById = await db.prepare(
        'SELECT id, email, username FROM "user" WHERE id = ? LIMIT 1',
      ).bind(command.userId).first<RegistrationIdentity>()
      const identityByEmail = await db.prepare(
        'SELECT id FROM "user" WHERE email = ? LIMIT 1',
      ).bind(command.email).first<{ id: string }>()
      return {
        identityById: identityById ?? null,
        identityByEmailId: identityByEmail?.id ?? null,
      }
    },

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
