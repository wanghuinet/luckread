import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyWranglerTailStderr } from './auth-007-classify-wrangler-tail-stderr.mjs'

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
const SAFE_LEVELS = new Set(['debug', 'info', 'log', 'warn', 'error'])
const MARKER_PREFIX = 'W02 scheduled publication'
const MALFORMED_LINE_CATEGORY_KEYS = [
  'AUTH_OR_PERMISSION',
  'NETWORK_OR_CONNECTION',
  'WORKER_OR_SCOPE_NOT_FOUND',
  'RATE_LIMITED',
  'WRANGLER_CONFIGURATION_OR_ARGUMENT',
  'CLOUDFLARE_API_FAILURE_REDACTED',
  'OTHER_ERROR_DETAILS_REDACTED',
  'NONEMPTY_UNCLASSIFIED_DETAILS_REDACTED',
]

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
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
      if (!Number.isSafeInteger(detail[key]) || detail[key] < 0) return null
      safe[key] = value
    }
    // Preserve only the four bounded receipt counters; never copy arbitrary log fields.
    for (const key of ['receiptSelected', 'receiptEmitted', 'receiptFailed', 'receiptUnknown']) {
      if (detail[key] === undefined) continue
      if (!Number.isSafeInteger(detail[key]) || detail[key] < 0) return null
      safe[key] = detail[key]
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

export function createRuntimeTailStats() {
  return {
    recordsSeen: 0,
    malformedJsonLines: 0,
    nonObjectRecords: 0,
    recordsWithoutLogsArray: 0,
    recordsWithLogs: 0,
    logEntriesSeen: 0,
    markerPrefixCandidates: 0,
    recognizedMarkers: {
      tick: 0,
      result: 0,
      taskFailed: 0,
      stageFailed: 0,
    },
    levels: { debug: 0, info: 0, log: 0, warn: 0, error: 0 },
    malformedLineCategories: Object.fromEntries(MALFORMED_LINE_CATEGORY_KEYS.map((key) => [key, 0])),
  }
}

export function summarizeRuntimeTailStats(stats) {
  return {
    diagnostic: 'W02_TAIL_CAPTURE_SUMMARY',
    recordsSeen: safeCount(stats.recordsSeen),
    malformedJsonLines: safeCount(stats.malformedJsonLines),
    nonObjectRecords: safeCount(stats.nonObjectRecords),
    recordsWithoutLogsArray: safeCount(stats.recordsWithoutLogsArray),
    recordsWithLogs: safeCount(stats.recordsWithLogs),
    logEntriesSeen: safeCount(stats.logEntriesSeen),
    markerPrefixCandidates: safeCount(stats.markerPrefixCandidates),
    recognizedMarkers: {
      tick: safeCount(stats.recognizedMarkers?.tick),
      result: safeCount(stats.recognizedMarkers?.result),
      taskFailed: safeCount(stats.recognizedMarkers?.taskFailed),
      stageFailed: safeCount(stats.recognizedMarkers?.stageFailed),
    },
    levels: {
      debug: safeCount(stats.levels?.debug),
      info: safeCount(stats.levels?.info),
      log: safeCount(stats.levels?.log),
      warn: safeCount(stats.levels?.warn),
      error: safeCount(stats.levels?.error),
    },
    malformedLineCategories: Object.fromEntries(
      MALFORMED_LINE_CATEGORY_KEYS.map((key) => [key, safeCount(stats.malformedLineCategories?.[key])]),
    ),
  }
}

export function recordMalformedRuntimeLine(line, stats) {
  if (!stats || typeof stats !== 'object') return
  stats.malformedJsonLines = safeCount(stats.malformedJsonLines) + 1
  if (typeof line !== 'string' || line.trim().length === 0) return
  const category = classifyWranglerTailStderr(line)
  if (Object.hasOwn(stats.malformedLineCategories ?? {}, category)) {
    stats.malformedLineCategories[category] = safeCount(stats.malformedLineCategories[category]) + 1
  }
}

/**
 * Retain only fixed W02 marker values and aggregate shape counters.
 * No request metadata, user identifiers, payloads, URLs, arbitrary messages,
 * token material, or exception strings are ever copied to the artifact.
 */
export function sanitizeRuntimeTailRecord(record, stats) {
  if (stats) stats.recordsSeen += 1
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    if (stats) stats.nonObjectRecords += 1
    return null
  }

  if (!Array.isArray(record.logs)) {
    if (stats) stats.recordsWithoutLogsArray += 1
    return null
  }
  if (record.logs.length > 0 && stats) stats.recordsWithLogs += 1

  const acceptedLogs = []
  for (const item of record.logs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    if (typeof item.level === 'string' && SAFE_LEVELS.has(item.level) && stats) {
      stats.levels[item.level] += 1
    }
    const message = Array.isArray(item.message)
      ? item.message
      : typeof item.message === 'string'
        ? [item.message]
        : []
    if (!stats) {
      // Tests and call sites without stats still get strict sanitization.
    } else {
      stats.logEntriesSeen += 1
    }
    const textParts = message.filter((part) => typeof part === 'string')
    if (stats && textParts.some((part) => part.includes(MARKER_PREFIX))) {
      stats.markerPrefixCandidates += 1
    }

    const labelIndex = message.findIndex((part) => typeof part === 'string' && SAFE_LABELS.has(part))
    if (labelIndex < 0) continue
    const label = message[labelIndex]
    const metricKey = label === 'W02 scheduled publication tick' ? 'tick'
      : label === 'W02 scheduled publication result' ? 'result'
        : label === 'W02 scheduled publication task failed' ? 'taskFailed'
          : 'stageFailed'
    if (stats) stats.recognizedMarkers[metricKey] += 1
    const sanitized = safeDetail(label, message[labelIndex + 1])
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


function writeLiveStats(stats) {
  const path = process.env.AUTH007_TAIL_STATS_FILE
  if (!path) return
  try {
    // This sidecar contains aggregate counters only; never write any raw log line.
    writeFileSync(path, JSON.stringify(summarizeRuntimeTailStats(stats)) + '\n', { mode: 0o600 })
  } catch {
    // Telemetry must never change the tail sanitizer's streaming behavior.
  }
}

function run() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const stats = createRuntimeTailStats()
  writeLiveStats(stats)
  let summaryEmitted = false

  const emitSummary = () => {
    if (summaryEmitted) return
    summaryEmitted = true
    process.stdout.write(JSON.stringify(summarizeRuntimeTailStats(stats)) + '\n', () => {
      process.exit(0)
    })
  }

  input.on('line', (line) => {
    try {
      const record = JSON.parse(line)
      const safe = sanitizeRuntimeTailRecord(record, stats)
      if (safe) process.stdout.write(JSON.stringify(safe) + '\n')
    } catch {
      // Wrangler banners and errors printed to stdout are categorized with
      // fixed labels only; raw text is never copied to the artifact.
      recordMalformedRuntimeLine(line, stats)
    }
    writeLiveStats(stats)
  })
  input.on('close', () => {
    writeLiveStats(stats)
    emitSummary()
  })
  process.on('SIGTERM', emitSummary)
  process.on('SIGINT', emitSummary)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run()
