import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const requiredContracts = [
  'docs/16-P0-PAYLOAD-AUTHORIZATION-BOUNDARY-CONTRACT-v1.0.md',
  'docs/17-P0-AUTHORIZATION-IMPLEMENTATION-AUDIT-v1.0.md',
  'docs/18-P0-PAYLOAD-IMPLEMENTATION-ADMISSION-GATE-v1.0.md',
  'contracts/authz/authorization-decision.json',
  'contracts/authz/authorization-decision.schema.json',
  'contracts/authz/field-policy.json',
  'contracts/authz/subject-types.json',
]

for (const file of requiredContracts) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`PAYLOAD_ADMISSION_FAIL missing ${file}`)
  }
}

const sourceRoots = ['src', 'app', 'collections', 'payload', 'lib', 'server', 'routes']
const sourceFiles = []

function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) sourceFiles.push(full)
  }
}

for (const dir of sourceRoots) walk(path.join(root, dir))

// No implementation is currently admitted. In that state the gate verifies
// the contract boundary and exits successfully without pretending implementation
// security has passed.
if (sourceFiles.length === 0) {
  console.log('PAYLOAD_IMPLEMENTATION_ADMISSION=NOT_YET_IMPLEMENTED')
  console.log('PAYLOAD_SECURITY_GREEN=BLOCKED')
  process.exit(0)
}

const suspicious = []
const patterns = [
  { name: 'direct-admin-bypass', re: /(?:user|req\.user|actor).*role\s*={2,3}\s*["']admin["']/i },
  { name: 'body-spread-update', re: /\.update\s*\([^\n]*\.\.\.\s*(?:req\.)?body/i },
  { name: 'protected-role-assignment', re: /(?:role|status|owner_id|organization_id|scope_id)\s*:\s*(?:req\.)?body\./i },
  { name: 'payload-admin-public-bypass', re: /isSuperAdmin\s*\(|req\.user\.isAdmin/i },
]

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    if (pattern.re.test(text)) suspicious.push(`${pattern.name}: ${path.relative(root, file)}`)
  }
}

if (suspicious.length) {
  console.error('PAYLOAD_IMPLEMENTATION_ADMISSION=FAIL')
  for (const finding of suspicious) console.error(` - ${finding}`)
  process.exit(1)
}

console.log(`PAYLOAD_IMPLEMENTATION_STATIC_SCAN=GREEN files=${sourceFiles.length}`)
console.log('PAYLOAD_SECURITY_GREEN=BLOCKED_UNTIL_E2E')
