import { describe, expect, it } from 'vitest'
import {
  readSocialActorAccountState,
  assertTrustedSocialAccountStateRead,
} from './account-state-read.js'

function fakeDb(row: { accountState: string; accountStateVersion: number } | null) {
  return {
    prepare() {
      return {
        bind() {
          return {
            first: async <T>() => row as T | null,
          }
        },
      }
    },
  }
}

const trusted = {
  caller: 'W01',
  transportVersion: '1.0',
  principalUserId: 'user-a',
  correlationId: 'corr-1',
  userId: 'user-a',
}

describe('W01→W02 Social account-state read', () => {
  it('reads the canonical D1-01 state', async () => {
    await expect(readSocialActorAccountState(
      fakeDb({ accountState: 'ACTIVE', accountStateVersion: 7 }) as never,
      trusted,
    )).resolves.toEqual({
      userId: 'user-a',
      accountState: 'ACTIVE',
      accountStateVersion: 7,
    })
  })

  it('fails closed for principal mismatch', () => {
    expect(() => assertTrustedSocialAccountStateRead({
      ...trusted,
      userId: 'user-b',
    })).toThrow('INVALID_PRINCIPAL')
  })

  it('returns NOT_FOUND without inventing an account state', async () => {
    await expect(readSocialActorAccountState(fakeDb(null) as never, trusted))
      .rejects.toThrow('NOT_FOUND')
  })
})
