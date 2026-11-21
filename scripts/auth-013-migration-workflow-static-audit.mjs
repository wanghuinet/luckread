import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

const cases = [
  {
    file: '.github/workflows/auth-013-account-state-migration.yml',
    required: [
      'count[0]?.success !== true',
      'schema[0]?.success !== true',
      'AUTH-013 preflight failed: users count query',
      'AUTH-013 preflight failed: users schema query',
      'AUTH-013 post-migration failed: users count query',
      'AUTH-013 post-migration failed: users schema query',
    ],
    requiredCount: [
      ['count[0]?.success !== true', 2],
      ['schema[0]?.success !== true', 2],
    ],
  },
  {
    file: '.github/workflows/auth-013-publication-journal-migration.yml',
    required: [
      'schema[0]?.success !== true',
      'indexes[0]?.success !== true',
      'AUTH-013 preflight failed: journal schema query',
      'AUTH-013 post-migration failed: journal schema query',
      'AUTH-013 post-migration failed: journal index query',
    ],
    requiredCount: [
      ['schema[0]?.success !== true', 2],
      ['indexes[0]?.success !== true', 1],
    ],
  },
]

const forbidden = [
  'schema?.[0]?.results ?? []',
  'indexes?.[0]?.results ?? []',
  'count?.[0]?.results?.[0]?.users_count',
]

function countOccurrences(text, needle) {
  return text.split(needle).length - 1
}

let checkedScripts = 0

for (const entry of cases) {
  const filePath = path.join(root, entry.file)
  if (!fs.existsSync(filePath)) throw new Error(`AUTH-013 migration workflow missing: ${entry.file}`)
  const content = fs.readFileSync(filePath, 'utf8')

  for (const fragment of entry.required) {
    if (!content.includes(fragment)) {
      throw new Error(`AUTH-013 migration workflow missing fail-closed guard in ${entry.file}: ${fragment}`)
    }
  }

  for (const [fragment, expected] of entry.requiredCount) {
    const actual = countOccurrences(content, fragment)
    if (actual !== expected) {
      throw new Error(`AUTH-013 migration workflow expected ${expected} occurrence(s) of "${fragment}" in ${entry.file}, got ${actual}`)
    }
  }

  for (const fragment of forbidden) {
    if (content.includes(fragment)) {
      throw new Error(`AUTH-013 migration workflow contains unsafe empty-result fallback in ${entry.file}: ${fragment}`)
    }
  }

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "node - <<'NODE'") continue
    const end = lines.findIndex((line, index) => index > i && line.trim() === 'NODE')
    if (end < 0) throw new Error(`AUTH-013 migration workflow has unterminated Node heredoc: ${entry.file}`)

    const script = lines.slice(i + 1, end)
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n')
    try {
      // Parse only: scripts that contact Cloudflare or mutate D1 are never executed here.
      new Function(script)
    } catch (error) {
      throw new Error(`AUTH-013 migration workflow Node script syntax error in ${entry.file}: ${error.message}`)
    }
    checkedScripts += 1
    i = end
  }
}

console.log(JSON.stringify({
  AUTH_013_MIGRATION_WORKFLOW_STATIC_AUDIT: 'PASS',
  workflowsChecked: cases.length,
  embeddedNodeScriptsSyntaxChecked: checkedScripts,
  productionMutationExecuted: false,
}, null, 2))
