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
