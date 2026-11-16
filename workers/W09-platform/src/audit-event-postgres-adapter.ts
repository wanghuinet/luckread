/**
 * W09-owned PostgreSQL adapter for the D1-03 AuditEvent table.
 *
 * AuditEvent is append-only and W09-owned. W06 keeps its existing D1-shaped
 * compatibility API, but its Neon adapter delegates every AuditEvent statement
 * through this boundary while retaining the caller's PostgreSQL transaction.
 */

export type W09AuditEventPostgresStatement = Readonly<{
  sql: string
  extraValues: unknown[]
}>

function normalizeForPolicy(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
}

function assertAllowedAuditEventStatement(sourceSql: string): void {
  const sql = normalizeForPolicy(sourceSql)
  if (!/\baudit_events\b/i.test(sql)) {
    throw new Error('W09_AUDIT_EVENT_STATEMENT_NOT_TARGETED')
  }

  const select = /^SELECT\b/i.test(sql) && /\bFROM\s+audit_events\b/i.test(sql)
  const insert = /^INSERT\s+INTO\s+audit_events\b/i.test(sql)
  const hasOtherTableReference = /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?!audit_events\b)[a-z_][a-z0-9_.]*\b/i.test(
    sql.replace(/\bFROM\s+audit_events\b/gi, 'FROM audit_events'),
  )
  const mutatingConflict = /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(sql)

  if ((!select && !insert) || hasOtherTableReference || mutatingConflict ||
      /\b(?:UPDATE|DELETE|TRUNCATE|REPLACE)\b/i.test(sql)) {
    throw new Error('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  }
}

/**
 * Translate only the W09-owned AuditEvent subset of D1 SQL.
 *
 * Returns null for statements owned by other D1-03 tables. SELECT and INSERT
 * retain ordinary PostgreSQL transaction behavior; no UPDATE/DELETE operation
 * is exposed through this adapter. SQLite changes() is resolved from the
 * preceding statement in the same caller-owned D1 batch.
 */
export function translateW09AuditEventD1Statement(
  sourceSql: string,
  previousChanges?: number,
): W09AuditEventPostgresStatement | null {
  const normalized = normalizeForPolicy(sourceSql)
  if (!/\baudit_events\b/i.test(normalized)) return null
  assertAllowedAuditEventStatement(sourceSql)

  let result = ''
  let position = 0
  let parameter = 0
  let singleQuoted = false
  let doubleQuoted = false
  let lineComment = false
  let blockComment = false
  const extraValues: unknown[] = []

  while (position < sourceSql.length) {
    const char = sourceSql[position]!
    const next = sourceSql[position + 1]

    if (lineComment) {
      result += char
      position += 1
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      result += char
      position += 1
      if (char === '*' && next === '/') {
        result += '/'
        position += 1
        blockComment = false
      }
      continue
    }
    if (singleQuoted) {
      result += char
      position += 1
      if (char === "'" && next === "'") {
        result += next
        position += 1
      } else if (char === "'") {
        singleQuoted = false
      }
      continue
    }
    if (doubleQuoted) {
      result += char
      position += 1
      if (char === '"' && next === '"') {
        result += next
        position += 1
      } else if (char === '"') {
        doubleQuoted = false
      }
      continue
    }

    const changesMatch = /^changes\s*\(\s*\)/i.exec(sourceSql.slice(position))
    if (changesMatch) {
      if (previousChanges === undefined || !Number.isSafeInteger(previousChanges) || previousChanges < 0) {
        throw new Error('W09_AUDIT_EVENT_CHANGES_REQUIRES_BATCH_CONTEXT')
      }
      parameter += 1
      result += '$' + parameter
      extraValues.push(previousChanges)
      position += changesMatch[0].length
    } else if (char === '-' && next === '-') {
      result += '--'
      position += 2
      lineComment = true
    } else if (char === '/' && next === '*') {
      result += '/*'
      position += 2
      blockComment = true
    } else if (char === "'") {
      result += char
      position += 1
      singleQuoted = true
    } else if (char === '"') {
      result += char
      position += 1
      doubleQuoted = true
    } else if (char === '?') {
      parameter += 1
      result += '$' + parameter
      position += 1
    } else {
      result += char
      position += 1
    }
  }

  return { sql: result, extraValues }
}
