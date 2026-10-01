import type { D1Database } from '@cloudflare/workers-types'
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

export async function readSocialActorAccountState(
  db: D1Database,
  input: {
    caller: string
    transportVersion: string
    principalUserId: string
    correlationId: string
    userId: string
  },
): Promise<SocialActorAccountState> {
  assertTrustedSocialAccountStateRead(input)
  try {
    const row = await db.prepare(
      'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM users WHERE id = ? LIMIT 1',
    ).bind(input.userId).first<{
      accountState: AccountState
      accountStateVersion: number
    }>()
    if (!row) throw new SocialAccountStateReadError('NOT_FOUND')
    if (!Number.isSafeInteger(row.accountStateVersion) || row.accountStateVersion < 1) {
      throw new SocialAccountStateReadError('SERVICE_UNAVAILABLE')
    }
    return {
      userId: input.userId,
      accountState: row.accountState,
      accountStateVersion: row.accountStateVersion,
    }
  } catch (error) {
    if (error instanceof SocialAccountStateReadError) throw error
    throw new SocialAccountStateReadError('SERVICE_UNAVAILABLE')
  }
}

export function mapSocialAccountStateReadError(error: unknown): { status: number; code: string } {
  const code = error instanceof SocialAccountStateReadError ? error.code : 'SERVICE_UNAVAILABLE'
  const status =
    code === 'UNTRUSTED_CALLER' ? 403 :
    code === 'INVALID_PRINCIPAL' || code === 'INVALID_CORRELATION' ? 400 :
    code === 'NOT_FOUND' ? 404 :
    503
  return { status, code }
}
