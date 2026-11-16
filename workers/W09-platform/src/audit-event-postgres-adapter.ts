/**
 * W09-owned append-only SQL policy for the D1-03 AuditEvent table.
 *
 * W06 retains its tested PostgreSQL D1 compatibility translator and owns each
 * surrounding transaction. This boundary grants only AuditEvent SELECT/INSERT;
 * the existing W09 PostgreSQL triggers also reject row mutation at the database.
 */

function normalizeForPolicy(sql: string): string {
  return sql
    // Strip literal payload values first so comment markers inside strings remain data.
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
}

/**
 * Return false for statements owned by another D1-03 table. When the statement
 * targets AuditEvent, throw unless it is an append-only SELECT or INSERT.
 */
export function assertW09AuditEventStatement(sourceSql: string): boolean {
  const sql = normalizeForPolicy(sourceSql)
  if (!/\baudit_events\b/i.test(sql)) return false

  const select = /^SELECT\b/i.test(sql) && /\bFROM\s+audit_events\b/i.test(sql)
  const insert = /^INSERT\s+INTO\s+audit_events\b/i.test(sql)
  const hasOtherTableReference = /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?!audit_events\b)[a-z_][a-z0-9_.]*\b/i.test(sql)
  const mutatingConflict = /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(sql)

  if ((!select && !insert) || hasOtherTableReference || mutatingConflict) {
    throw new Error('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  }

  return true
}
