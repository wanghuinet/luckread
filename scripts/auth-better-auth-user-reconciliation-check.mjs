import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const DATABASE_NAME = String(process.env.DATABASE_NAME || 'luckread')
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.116.0'
const CONFIG = process.env.W01_WRANGLER_CONFIG || 'workers/W01-payload/wrangler.jsonc'
const OUTPUT = process.env.OUTPUT_PATH || 'artifacts/evidence/auth-better-auth/user-reconciliation.json'

const sql = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const hash = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16)

const d1Json = (command) => {
  const raw = execFileSync(
    'npx',
    [
      '--yes',
      'wrangler@' + WRANGLER_VERSION,
      'd1',
      'execute',
      DATABASE_NAME,
      '--remote',
      '--json',
      '--yes',
      '--config',
      CONFIG,
      '--command',
      command,
    ],
    { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(raw)
}

const rows = (value) =>
  Array.isArray(value)
    ? value.flatMap((item) => Array.isArray(item) ? item : (item?.results ?? item?.result ?? []))
    : (value?.results ?? value?.result ?? [])

const one = (command) => rows(d1Json(command))[0] ?? null

const tableExists = (name) => {
  try {
    return Boolean(one(
      'SELECT 1 AS present FROM sqlite_master WHERE type = ' + sql('table') +
      ' AND name = ' + sql(name) + ' LIMIT 1',
    )?.present)
  } catch {
    return false
  }
}

const report = {
  status: 'PASS',
  mode: 'READ_ONLY_REMOTE_RECONCILIATION',
  database: DATABASE_NAME,
  checkedAt: new Date().toISOString(),
  authority: 'Better Auth / W02 / D1-01',
  legacyTablePresent: false,
  legacyUserCount: 0,
  betterAuthUserCount: 0,
  matchedByNormalizedEmail: 0,
  legacyMissingInBetterAuth: 0,
  duplicateBetterAuthEmails: 0,
  issues: [],
}

if (!tableExists('user')) {
  report.status = 'FAIL'
  report.issues.push('Better Auth "user" table is absent')
} else {
  report.betterAuthUserCount = Number(
    one('SELECT COUNT(*) AS count FROM "user"')?.count ?? 0,
  )
  report.duplicateBetterAuthEmails = Number(
    one(
      'SELECT COUNT(*) AS count FROM (' +
      'SELECT lower(trim(email)) AS normalized_email FROM "user" ' +
      'GROUP BY lower(trim(email)) HAVING COUNT(*) > 1' +
      ')',
    )?.count ?? 0,
  )
  if (report.duplicateBetterAuthEmails !== 0) {
    report.status = 'FAIL'
    report.issues.push('Better Auth "user" contains duplicate normalized emails')
  }
}

if (tableExists('users')) {
  report.legacyTablePresent = true
  report.legacyUserCount = Number(
    one('SELECT COUNT(*) AS count FROM users')?.count ?? 0,
  )

  if (!tableExists('user')) {
    report.status = 'FAIL'
    report.legacyMissingInBetterAuth = report.legacyUserCount
  } else if (report.legacyUserCount > 0) {
    const legacy = rows(
      d1Json(
        'SELECT lower(trim(email)) AS normalized_email FROM users ' +
        'WHERE email IS NOT NULL AND trim(email) <> ""',
      ),
    )
    const missing = rows(
      d1Json(
        'SELECT lower(trim(email)) AS normalized_email FROM users ' +
        'WHERE email IS NOT NULL AND trim(email) <> "" ' +
        'AND lower(trim(email)) NOT IN (SELECT lower(trim(email)) FROM "user")',
      ),
    )

    report.matchedByNormalizedEmail = legacy.length - missing.length
    report.legacyMissingInBetterAuth = missing.length

    if (missing.length !== 0) {
      report.status = 'FAIL'
      report.issues.push('Legacy Payload users are missing from Better Auth "user"')
      report.missingEmailHashes = missing
        .slice(0, 20)
        .map((row) => hash(row.normalized_email))
    }
  }
}

if (!report.legacyTablePresent) {
  report.issues.push('Legacy Payload users table is absent; no historical rows remain to reconcile')
}

writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + '\n')

console.log(JSON.stringify({
  status: report.status,
  legacyTablePresent: report.legacyTablePresent,
  legacyUserCount: report.legacyUserCount,
  betterAuthUserCount: report.betterAuthUserCount,
  matchedByNormalizedEmail: report.matchedByNormalizedEmail,
  legacyMissingInBetterAuth: report.legacyMissingInBetterAuth,
  duplicateBetterAuthEmails: report.duplicateBetterAuthEmails,
  issueCount: report.issues.length,
}))
if (report.status !== 'PASS') process.exitCode = 1
