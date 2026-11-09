import test from 'node:test'
import assert from 'node:assert/strict'
import { validateD103RemoteRunnerReview } from './remote-runner-review.mjs'

test('pending D1-03 partial remote review cannot release the schema runner', () => {
  const result = validateD103RemoteRunnerReview({
    review: {
      status: 'REMOTE_PARTIAL_SCHEMA_RELEASE_PENDING',
      partialRemoteApplyReady: false,
      remoteApplyReady: false,
      repository: 'wanghuinet/luckread',
    },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.length > 0)
})
