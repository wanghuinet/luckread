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
