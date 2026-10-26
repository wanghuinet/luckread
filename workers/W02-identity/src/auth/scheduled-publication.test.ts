import { describe, expect, it, vi } from 'vitest'
import { runScheduledPublicationTicks } from './scheduled-publication'

describe('W02 scheduled publication isolation', () => {
  it('attempts MFA audit publication even when account-state publication rejects', async () => {
    const accountStatePublish = vi.fn().mockRejectedValue(new Error('sensitive upstream error'))
    const mfaAuditPublish = vi.fn().mockResolvedValue({ selected: 1, published: 1, failed: 0 })
    const logFailure = vi.fn()
    const logMfaAuditSummary = vi.fn()

    await expect(runScheduledPublicationTicks([
      { name: 'account-state', publish: accountStatePublish },
      { name: 'mfa-audit', publish: mfaAuditPublish },
    ], logFailure, logMfaAuditSummary)).resolves.toBeUndefined()

    expect(accountStatePublish).toHaveBeenCalledTimes(1)
    expect(mfaAuditPublish).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledWith('account-state')
    expect(logFailure).not.toHaveBeenCalledWith('mfa-audit')
    expect(logMfaAuditSummary).toHaveBeenCalledTimes(1)
    expect(logMfaAuditSummary).toHaveBeenCalledWith({ selected: 1, published: 1, failed: 0 })
  })

  it('contains an MFA publisher rejection without throwing from the cron handler', async () => {
    const accountStatePublish = vi.fn().mockResolvedValue({ selected: 0, published: 0, failed: 0 })
    const mfaAuditPublish = vi.fn().mockRejectedValue(new Error('sensitive queue failure'))
    const logFailure = vi.fn()
    const logMfaAuditSummary = vi.fn()

    await expect(runScheduledPublicationTicks([
      { name: 'account-state', publish: accountStatePublish },
      { name: 'mfa-audit', publish: mfaAuditPublish },
    ], logFailure, logMfaAuditSummary)).resolves.toBeUndefined()

    expect(accountStatePublish).toHaveBeenCalledTimes(1)
    expect(mfaAuditPublish).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledTimes(1)
    expect(logFailure).toHaveBeenCalledWith('mfa-audit')
    expect(logMfaAuditSummary).not.toHaveBeenCalled()
  })

  it('surfaces receipt retries and unresolved operation outcomes in the MFA summary', async () => {
    const logMfaAuditSummary = vi.fn()
    const summary = {
      selected: 0,
      published: 0,
      failed: 0,
      receiptSelected: 1,
      receiptEmitted: 0,
      receiptFailed: 0,
      receiptUnknown: 1,
    }

    await runScheduledPublicationTicks([
      { name: 'mfa-audit', publish: async () => summary },
    ], vi.fn(), logMfaAuditSummary)

    expect(logMfaAuditSummary).toHaveBeenCalledTimes(1)
    expect(logMfaAuditSummary).toHaveBeenCalledWith(summary)
  })

  it('does not emit an empty MFA summary or accept untrusted count shapes', async () => {
    const logMfaAuditSummary = vi.fn()
    await runScheduledPublicationTicks([
      { name: 'mfa-audit', publish: async () => ({ selected: 0, published: 0, failed: 0 }) },
    ], vi.fn(), logMfaAuditSummary)
    await runScheduledPublicationTicks([
      { name: 'mfa-audit', publish: async () => ({ selected: '8', published: 8, failed: 0 }) },
    ], vi.fn(), logMfaAuditSummary)
    expect(logMfaAuditSummary).not.toHaveBeenCalled()
  })
})
