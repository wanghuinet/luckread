import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SAFE_LABELS = new Set([
  'W02 scheduled publication tick',
  'W02 scheduled publication result',
  'W02 scheduled publication task failed',
  'W02 scheduled publication stage failed',
])
const TASKS = new Set(['account-state', 'mfa-audit'])
const STAGES = new Set([
  'select-pending',
  'mark-invalid-payload',
  'mark-retry',
  'mark-published',
])

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeDetail(label, raw) {
  const detail = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const safe = { label }
  if (label === 'W02 scheduled publication tick') {
    if (typeof detail.cron === 'string' && detail.cron.length <= 64) safe.cron = detail.cron
    if (Number.isSafeInteger(detail.scheduledTime) && detail.scheduledTime >= 0) {
      safe.scheduledTime = detail.scheduledTime
    }
  } else if (label === 'W02 scheduled publication result') {
    if (detail.task !== 'mfa-audit') return null
    safe.task = 'mfa-audit'
    for (const key of ['selected', 'published', 'failed']) {
      const value = safeCount(detail[key])
      if (value === undefined) return null
      safe[key] = value
    }
  } else if (label === 'W02 scheduled publication task failed') {
    if (!TASKS.has(detail.task)) return null
    safe.task = detail.task
  } else if (label === 'W02 scheduled publication stage failed') {
    if (detail.task !== 'mfa-audit' || !STAGES.has(detail.stage)) return null
    safe.task = 'mfa-audit'
    safe.stage = detail.stage
  }
  return safe
}

/**
 * Keep only explicit W02 scheduled-publication labels and an allowlist of
 * counts/stage fields. Request details, user identifiers, payloads, URLs,
 * arbitrary log messages, and thrown error text are never copied.
 */
export function sanitizeRuntimeTailRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const acceptedLogs = []
  for (const item of Array.isArray(record.logs) ? record.logs : []) {
    if (!item || typeof item !== 'object') continue
    const message = Array.isArray(item.message) ? item.message : []
    const label = message[0]
    if (typeof label !== 'string' || !SAFE_LABELS.has(label)) continue
    const sanitized = safeDetail(label, message[1])
    if (sanitized) acceptedLogs.push(sanitized)
  }
  if (acceptedLogs.length === 0) return null

  const safeRecord = { logs: acceptedLogs }
  if (Number.isSafeInteger(record.eventTimestamp) && record.eventTimestamp >= 0) {
    safeRecord.eventTimestamp = record.eventTimestamp
  }
  if (['ok', 'error', 'canceled', 'unknown'].includes(record.outcome)) {
    safeRecord.outcome = record.outcome
  }
  return safeRecord
}

function run() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  input.on('line', (line) => {
    try {
      const safe = sanitizeRuntimeTailRecord(JSON.parse(line))
      if (safe) process.stdout.write(JSON.stringify(safe) + '\n')
    } catch {
      // Wrangler connection banners and malformed lines are intentionally dropped.
    }
  })
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run()
