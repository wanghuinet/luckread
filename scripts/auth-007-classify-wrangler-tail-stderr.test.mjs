import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyWranglerTailStderr } from './auth-007-classify-wrangler-tail-stderr.mjs'

describe('AUTH-007 Wrangler tail stderr classifier', () => {
  it('classifies common Cloudflare token and permission failures without returning source text', () => {
    for (const sample of [
      'Error: Authentication error (code 10000)',
      'Insufficient permissions: Workers Tail Read is required',
      '403 Forbidden: permission denied',
      'Invalid API token',
    ]) {
      const category = classifyWranglerTailStderr(sample)
      assert.equal(category, 'AUTH_OR_PERMISSION')
      assert.equal(sample.includes(category), false)
    }
  })

  it('classifies network and transport failures', () => {
    assert.equal(classifyWranglerTailStderr('Error: connect ETIMEDOUT'), 'NETWORK_OR_CONNECTION')
    assert.equal(classifyWranglerTailStderr('WebSocket connection closed'), 'NETWORK_OR_CONNECTION')
  })

  it('classifies worker-not-found and rate-limited errors without retaining details', () => {
    assert.equal(classifyWranglerTailStderr('Worker script not found'), 'WORKER_OR_SCOPE_NOT_FOUND')
    assert.equal(classifyWranglerTailStderr('HTTP 429 Too Many Requests'), 'RATE_LIMITED')
  })

  it('keeps unknown and generic errors redacted', () => {
    assert.equal(classifyWranglerTailStderr('Error: custom internal details'), 'OTHER_ERROR_DETAILS_REDACTED')
    assert.equal(classifyWranglerTailStderr('opaque diagnostic'), 'NONEMPTY_UNCLASSIFIED_DETAILS_REDACTED')
    assert.equal(classifyWranglerTailStderr('  '), 'STDERR_EMPTY')
    assert.equal(classifyWranglerTailStderr(null), 'STDERR_EMPTY')
  })
})
