import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runD103RemoteDomain } from './remote-schema-runner.mjs'
import { assertD103RemoteApplyReady } from './assert-remote-apply-release.mjs'

const fail = (message) => { throw new Error('D1-03 remote schema apply: ' + message) }

export function parseCommandLine(argv) {
  return argv.length === 1 && argv[0] === '--remote-neon'
    ? { valid: true, mode: 'REMOTE_NEON' }
    : { valid: false, reason: 'select exactly: --remote-neon' }
}

async function run() {
  const selection = parseCommandLine(process.argv.slice(2))
  if (!selection.valid) fail(selection.reason)
  const release = assertD103RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
  if (release.partialRemoteApplyReady !== true || release.remoteApplyReady !== false) {
    fail('D1-03 partial schema release gate did not return the exact partial-only authorization')
  }
  await runD103RemoteDomain()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
