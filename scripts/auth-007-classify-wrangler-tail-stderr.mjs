import { readFile } from 'node:fs/promises'

const CATEGORIES = Object.freeze({
  EMPTY: 'STDERR_EMPTY',
  AUTH: 'AUTH_OR_PERMISSION',
  NETWORK: 'NETWORK_OR_CONNECTION',
  SCOPE: 'WORKER_OR_SCOPE_NOT_FOUND',
  RATE: 'RATE_LIMITED',
  OTHER: 'OTHER_ERROR_DETAILS_REDACTED',
  UNKNOWN: 'NONEMPTY_UNCLASSIFIED_DETAILS_REDACTED',
})

export function classifyWranglerTailStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.trim().length === 0) return CATEGORIES.EMPTY

  // Keep the classification deliberately coarse. Never return or persist the
  // raw Wrangler/Cloudflare diagnostic, request URL, account id, or token data.
  if (/(authentication|authenticat(?:e|ion)|invalid.{0,20}token|not authenticated|not logged in|unauthorized|forbidden|insufficient permissions?|missing.{0,30}permissions?|permission denied|access denied|not authorized|workers tail read|metadata read-only|(?:^|[^0-9])(401|403|10000)(?:[^0-9]|$))/i.test(stderr)) {
    return CATEGORIES.AUTH
  }
  if (/(websocket|connection|ECONN[A-Z]+|ETIMEDOUT|timed out|network|fetch failed|ENOTFOUND|socket|DNS|TLS handshake)/i.test(stderr)) {
    return CATEGORIES.NETWORK
  }
  if (/(worker|script|service).{0,60}(not found|does not exist|unknown)|not found.{0,60}(worker|script|service)/i.test(stderr)) {
    return CATEGORIES.SCOPE
  }
  if (/(rate.?limit|too many requests|(?:^|[^0-9])429(?:[^0-9]|$))/i.test(stderr)) {
    return CATEGORIES.RATE
  }
  if (/(error|failed|cannot|unable|denied)/i.test(stderr)) return CATEGORIES.OTHER
  return CATEGORIES.UNKNOWN
}

async function main() {
  const path = process.argv[2]
  let stderr = ''
  if (path) {
    try {
      stderr = await readFile(path, 'utf8')
    } catch {
      // Missing/unreadable diagnostic files are treated like an empty stream.
    }
  }
  const category = classifyWranglerTailStderr(stderr)
  const annotation = category === CATEGORIES.EMPTY ? 'notice' : 'warning'
  process.stdout.write(`::${annotation}::W02 tail diagnostic category=${category}\n`)
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
