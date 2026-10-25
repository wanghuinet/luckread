import { describe, expect, it, vi } from 'vitest'
import { runScheduledPublicationTicks } from './scheduled-publication'

describe('W02 scheduled publication isolation', () => {
  it('attempts MFA audit publication even when account-state publication rejects', async () => {
    const accountStatePublish = vi.fn().mockRejectedValue(new Error('sensitive upstream error'))
    const mfaAuditPublish = vi.fn().mockResolvedValue({ selected: 1, published: 1, failed: 0 })
    const logFailure = vi.fn()

    await expect(runScheduledPublicationTicks([
      { name: 'account-state', publish: accountStatePublish },
      { name: 'mfa-audit', publish: mfaAuditPublish },
    ], logFailure)).resolves.toBeUndefined()

    expect(accountStatePublish).toHaveBeenCalledTimes(1)
    expect(mfaAuditPublish).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledExactlyOnceWith('account-state')
    expect(logFailure).not.toHaveBeenCalledWith('mfa-audit')
  })

  it('contains an MFA publisher rejection without throwing from the cron handler', async () => {
    const accountStatePublish = vi.fn().mockResolvedValue({ selected: 0, published: 0, failed: 0 })
    const mfaAuditPublish = vi.fn().mockRejectedValue(new Error('sensitive queue failure'))
    const logFailure = vi.fn()

    await expect(runScheduledPublicationTicks([
      { name: 'account-state', publish: accountStatePublish },
      { name: 'mfa-audit', publish: mfaAuditPublish },
    ], logFailure)).resolves.toBeUndefined()

    expect(accountStatePublish).toHaveBeenCalledTimes(1)
    expect(mfaAuditPublish).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledExactlyOnceWith('mfa-audit')
  })
})
