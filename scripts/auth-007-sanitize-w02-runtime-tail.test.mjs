import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeRuntimeTailRecord } from './auth-007-sanitize-w02-runtime-tail.mjs'

describe('W02 runtime tail sanitizer', () => {
  it('keeps only a cron marker and safe scheduling metadata', () => {
    const output = sanitizeRuntimeTailRecord({
      eventTimestamp: 1792904400000,
      outcome: 'ok',
      event: { request: { url: 'https://api.luckread.com/private?token=secret' } },
      logs: [{
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
        { message: ['W02 scheduled publication result', { task: 'mfa-audit', selected: 8, published: 8, failed: 0, payload: 'secret' }] },
        { message: ['W02 scheduled publication result', { task: 'mfa-audit', selected: '8', published: 8, failed: 0 }] },
        { message: ['unrelated log', { token: 'secret' }] },
      ],
    })
    assert.deepEqual(output, {
      logs: [{ label: 'W02 scheduled publication result', task: 'mfa-audit', selected: 8, published: 8, failed: 0 }],
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
})
