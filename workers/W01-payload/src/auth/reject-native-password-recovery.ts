import { APIError } from 'payload'

const NATIVE_PASSWORD_RECOVERY_OPERATIONS = new Set(['forgotPassword', 'resetPassword'])

export const rejectNativePasswordRecovery = ({ operation }: { operation?: string }): void => {
  if (!NATIVE_PASSWORD_RECOVERY_OPERATIONS.has(operation ?? '')) {
    return
  }

  throw new APIError('Not Found', 404, null, true)
}
