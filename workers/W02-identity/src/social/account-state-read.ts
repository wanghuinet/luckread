import type { AccountState } from '../account/account-state-transition.js'

export type SocialActorAccountState = {
  userId: string
  accountState: AccountState
  accountStateVersion: number
}

export class SocialAccountStateReadError extends Error {
  constructor(readonly code: 'UNTRUSTED_CALLER' | 'INVALID_PRINCIPAL' | 'INVALID_CORRELATION' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE') {
    super(code)
  }
}

export function assertTrustedSocialAccountStateRead(input: {
  caller: string
  transportVersion: string
  principalUserId: string
  correlationId: string
  userId: string
}): void {
  if (input.caller !== 'W01' || input.transportVersion !== '1.0') {
    throw new SocialAccountStateReadError('UNTRUSTED_CALLER')
  }
  if (!input.principalUserId || !input.userId || input.userId !== input.principalUserId || input.userId.length > 128) {
    throw new SocialAccountStateReadError('INVALID_PRINCIPAL')
  }
  if (!input.correlationId || input.correlationId.length > 128) {
    throw new SocialAccountStateReadError('INVALID_CORRELATION')
  }
}
