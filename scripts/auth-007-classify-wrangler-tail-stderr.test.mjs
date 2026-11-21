import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyWranglerTailStderr, parseLifecycleMarker, parsePipelineExitStatus } from './auth-007-classify-wrangler-tail-stderr.mjs'

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
    assert.equal(classifyWranglerTailStderr('Unable to fetch the requested data'), 'NETWORK_OR_CONNECTION')
    assert.equal(classifyWranglerTailStderr('Failed to connect to Cloudflare API'), 'NETWORK_OR_CONNECTION')
  })

  it('classifies Cloudflare API and Wrangler tooling errors without retaining raw diagnostics', () => {
    assert.equal(classifyWranglerTailStderr('A request to the Cloudflare API failed with a server error'), 'CLOUDFLARE_API_FAILURE_REDACTED')
    assert.equal(classifyWranglerTailStderr('Unknown option --unsafe-option'), 'WRANGLER_CONFIGURATION_OR_ARGUMENT')
    assert.equal(classifyWranglerTailStderr('Command not found: wrangler'), 'WRANGLER_CONFIGURATION_OR_ARGUMENT')
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

  it('distinguishes intentional stream shutdown from unconfirmed process termination', () => {
    assert.equal(parseLifecycleMarker('INTENTIONAL_STOP'), 'INTENTIONAL_STOP')
    assert.equal(parseLifecycleMarker('unexpected error details'), 'UNCONFIRMED')
    assert.equal(parseLifecycleMarker(null), 'UNCONFIRMED')
  })

  it('retains only numeric Wrangler and sanitizer pipeline exit codes', () => {
    assert.deepEqual(parsePipelineExitStatus('wrangler=1 sanitizer=0'), {
      wranglerExitCode: '1',
      sanitizerExitCode: '0',
    })
    assert.deepEqual(parsePipelineExitStatus('bad input with private data'), {
      wranglerExitCode: 'UNKNOWN',
      sanitizerExitCode: 'UNKNOWN',
    })
  })
})
