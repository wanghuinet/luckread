#!/usr/bin/env node
/** Repository hygiene gate for the legacy `my/` area. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const allowedPrefix = 'my/reference/'
let tracked = ''
try {
  tracked = (await execFileAsync('git', ['ls-files'], { maxBuffer: 4 * 1024 * 1024 })).stdout
} catch (error) {
  console.error('Repository hygiene CI RED: git ls-files failed:', error.message)
  process.exit(1)
}

const violations = tracked
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((path) => path === 'my' || path.startsWith('my/'))
  .filter((path) => path !== 'my' && !path.startsWith(allowedPrefix))

if (violations.length) {
  console.error('Repository hygiene CI RED — scraped/exported files under my/ are forbidden:')
  for (const path of violations) console.error('  - ' + path)
  console.error('Allowed area: my/reference/**')
  process.exit(1)
}

console.log('Repository hygiene CI GREEN — my/ contains only intentional reference assets')
