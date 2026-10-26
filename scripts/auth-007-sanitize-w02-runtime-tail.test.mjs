import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRuntimeTailStats, recordMalformedRuntimeLine, sanitizeRuntimeTailRecord, summarizeRuntimeTailStats } from './auth-007-sanitize-w02-runtime-tail.mjs'

describe('W02 runtime tail sanitizer', () => {
  it('keeps only a cron marker and safe scheduling metadata', () => {
    const output = sanitizeRuntimeTailRecord({
      eventTimestamp: 1792904400000,
      outcome: 'ok',
      event: { request: { url: 'https://api.luckread.com/private?token=secret' } },
      logs: [{
        level: 'info',
        message: ['W02 scheduled publication tick', {
          cron: '* * * * *',
          scheduledTime: 1792904400000,
          userId: 'private-user-id',
          payload: { totpSecret: 'never-copy' },
        }],
      }],
    })
    assert.deepEqual(output, {
      logs: [{ label: 'W02 scheduled publication tick', cron: '* * * * *', scheduledTime: 1792904400000 }],
      eventTimestamp: 1792904400000,
      outcome: 'ok',
    })
    assert.equal(JSON.stringify(output).includes('secret'), false)
    assert.equal(JSON.stringify(output).includes('private-user-id'), false)
  })

  it('keeps publisher counts but rejects malformed counts and unrelated logs', () => {
    const output = sanitizeRuntimeTailRecord({
      logs: [
        { message: ['W02 scheduled publication result', { task: 'mfa-audit', selected: 8, published: 8, failed: 0, receiptSelected: 4, receiptEmitted: 3, receiptFailed: 0, receiptUnknown: 1, payload: 'secret' }] },
        { message: ['W02 scheduled publication result', { task: 'mfa-audit', selected: '8', published: 8, failed: 0 }] },
        { message: ['W02 scheduled publication result', { task: 'mfa-audit', selected: 8, published: 8, failed: 0, receiptUnknown: '1' }] },
        { message: ['unrelated log', { token: 'secret' }] },
      ],
    })
    assert.deepEqual(output, {
      logs: [{ label: 'W02 scheduled publication result', task: 'mfa-audit', selected: 8, published: 8, failed: 0, receiptSelected: 4, receiptEmitted: 3, receiptFailed: 0, receiptUnknown: 1 }],
    })
    assert.equal(JSON.stringify(output).includes('secret'), false)
  })

  it('retains only allowlisted failure stage codes', () => {
    const output = sanitizeRuntimeTailRecord({
      logs: [{
        message: ['W02 scheduled publication stage failed', {
          task: 'mfa-audit',
          stage: 'mark-published',
          error: 'db exception with private details',
        }],
      }],
    })
    assert.deepEqual(output, {
      logs: [{ label: 'W02 scheduled publication stage failed', task: 'mfa-audit', stage: 'mark-published' }],
    })
  })

  it('drops records without recognized runtime markers', () => {
    assert.equal(sanitizeRuntimeTailRecord({
      event: { request: { url: 'https://example.test/private' } },
      logs: [{ message: ['request complete', { email: 'private@example.test' }] }],
    }), null)
    assert.equal(sanitizeRuntimeTailRecord(null), null)
  })
  it('emits only aggregate stream-shape telemetry for records with no recognized marker', () => {
    const stats = createRuntimeTailStats()
    const output = sanitizeRuntimeTailRecord({
      event: { request: { url: 'https://api.luckread.com/private?token=must-not-escape' } },
      outcome: 'ok',
      eventTimestamp: 1792904400000,
      logs: [
        { level: 'info', message: ['unrecognized log label', { token: 'must-not-escape' }] },
        { level: 'error', message: ['private exception text must not escape'] },
      ],
    }, stats)
    assert.equal(output, null)
    assert.deepEqual(summarizeRuntimeTailStats(stats), {
      diagnostic: 'W02_TAIL_CAPTURE_SUMMARY',
      recordsSeen: 1,
      malformedJsonLines: 0,
      nonObjectRecords: 0,
      recordsWithoutLogsArray: 0,
      recordsWithLogs: 1,
      logEntriesSeen: 2,
      markerPrefixCandidates: 0,
      recognizedMarkers: { tick: 0, result: 0, taskFailed: 0, stageFailed: 0 },
      levels: { debug: 0, info: 1, log: 0, warn: 0, error: 1 },
      malformedLineCategories: {
        AUTH_OR_PERMISSION: 0,
        NETWORK_OR_CONNECTION: 0,
        WORKER_OR_SCOPE_NOT_FOUND: 0,
        RATE_LIMITED: 0,
        WRANGLER_CONFIGURATION_OR_ARGUMENT: 0,
        CLOUDFLARE_API_FAILURE_REDACTED: 0,
        OTHER_ERROR_DETAILS_REDACTED: 0,
        NONEMPTY_UNCLASSIFIED_DETAILS_REDACTED: 0,
      },
    })
    assert.equal(JSON.stringify(summarizeRuntimeTailStats(stats)).includes('must-not-escape'), false)
  })

  it('classifies malformed stdout errors using only safe fixed labels', () => {
    const stats = createRuntimeTailStats()
    recordMalformedRuntimeLine(
      'Error: 403 Forbidden for https://api.cloudflare.com/client/v4/accounts/private?token=must-not-escape',
      stats,
    )
    recordMalformedRuntimeLine('opaque malformed runtime line', stats)
    recordMalformedRuntimeLine('   ', stats)
    const summary = summarizeRuntimeTailStats(stats)
    assert.equal(summary.malformedJsonLines, 3)
    assert.equal(summary.malformedLineCategories.AUTH_OR_PERMISSION, 1)
    assert.equal(summary.malformedLineCategories.NONEMPTY_UNCLASSIFIED_DETAILS_REDACTED, 1)
    assert.equal(JSON.stringify(summary).includes('must-not-escape'), false)
    assert.equal(JSON.stringify(summary).includes('private'), false)
  })

  it('counts marker-like logs whose label shape differs without copying their content', () => {
    const stats = createRuntimeTailStats()
    sanitizeRuntimeTailRecord({
      logs: [{
        level: 'info',
        message: ['prefix: W02 scheduled publication tick', { cron: '* * * * *', accountId: 'secret' }],
      }],
    }, stats)
    const summary = summarizeRuntimeTailStats(stats)
    assert.equal(summary.markerPrefixCandidates, 1)
    assert.equal(summary.recognizedMarkers.tick, 0)
    assert.equal(JSON.stringify(summary).includes('secret'), false)
  })

})
