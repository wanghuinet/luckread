import { readFile } from 'node:fs/promises'

const CATEGORIES = Object.freeze({
  EMPTY: 'STDERR_EMPTY',
  AUTH: 'AUTH_OR_PERMISSION',
  NETWORK: 'NETWORK_OR_CONNECTION',
  SCOPE: 'WORKER_OR_SCOPE_NOT_FOUND',
  RATE: 'RATE_LIMITED',
  OTHER: 'OTHER_ERROR_DETAILS_REDACTED',
  UNKNOWN: 'NONEMPTY_UNCLASSIFIED_DETAILS_REDACTED',
  TOOLING: 'WRANGLER_CONFIGURATION_OR_ARGUMENT',
  API: 'CLOUDFLARE_API_FAILURE_REDACTED',
})

export function classifyWranglerTailStderr(stderr) {
  if (typeof stderr !== 'string' || stderr.trim().length === 0) return CATEGORIES.EMPTY

  // Keep the classification deliberately coarse. Never return or persist the
  // raw Wrangler/Cloudflare diagnostic, request URL, account id, or token data.
  if (/(authentication|authenticat(?:e|ion)|invalid.{0,20}token|not authenticated|not logged in|unauthorized|forbidden|insufficient permissions?|missing.{0,30}permissions?|permission denied|access denied|not authorized|workers tail read|metadata read-only|(?:^|[^0-9])(401|403|10000)(?:[^0-9]|$))/i.test(stderr)) {
    return CATEGORIES.AUTH
  }
  if (/(websocket|connection|ECONN[A-Z]+|ETIMEDOUT|timed out|network|fetch failed|failed.{0,40}(fetch|connect|connection|websocket|network|socket)|unable.{0,40}(fetch|connect|connection|network|socket)|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|DNS|TLS handshake)/i.test(stderr)) {
    return CATEGORIES.NETWORK
  }
  if (/(worker|script|service).{0,60}(not found|does not exist|unknown)|not found.{0,60}(worker|script|service)|no script found|could not find script/i.test(stderr)) {
    return CATEGORIES.SCOPE
  }
  if (/(rate.?limit|too many requests|(?:^|[^0-9])429(?:[^0-9]|$))/i.test(stderr)) {
    return CATEGORIES.RATE
  }
  if (/(unknown (?:option|argument|command)|invalid (?:option|argument|flag)|unexpected argument|could not determine executable to run|command not found|config(?:uration)? file.{0,40}(?:missing|not found|invalid)|npm error code e404|package.{0,40}not found)/i.test(stderr)) {
    return CATEGORIES.TOOLING
  }
  if (/(cloudflare api|api request|request to .*api|request failed|api error|http status.{0,10}5[0-9]{2}|status code.{0,10}5[0-9]{2})/i.test(stderr) &&
      /(error|failed|failure|denied|status)/i.test(stderr)) {
    return CATEGORIES.API
  }
  if (/(error|failed|cannot|unable|denied)/i.test(stderr)) return CATEGORIES.OTHER
  return CATEGORIES.UNKNOWN
}

export function parsePipelineExitStatus(raw) {
  if (typeof raw !== 'string') return { wranglerExitCode: 'UNKNOWN', sanitizerExitCode: 'UNKNOWN' }
  const match = raw.trim().match(/^wrangler=(\d{1,3}) sanitizer=(\d{1,3})$/)
  if (!match) return { wranglerExitCode: 'UNKNOWN', sanitizerExitCode: 'UNKNOWN' }
  return {
    wranglerExitCode: String(Number(match[1])),
    sanitizerExitCode: String(Number(match[2])),
  }
}

async function main() {
  const path = process.argv[2]
  const statusPath = process.argv[3]
  let stderr = ''
  let statusRaw = ''
  if (path) {
    try {
      stderr = await readFile(path, 'utf8')
    } catch {
      // Missing/unreadable diagnostic files are treated like an empty stream.
    }
  }
  if (statusPath) {
    try {
      statusRaw = await readFile(statusPath, 'utf8')
    } catch {
      // A missing status marker is represented as UNKNOWN.
    }
  }
  const category = classifyWranglerTailStderr(stderr)
  const { wranglerExitCode, sanitizerExitCode } = parsePipelineExitStatus(statusRaw)
  const annotation = category === CATEGORIES.EMPTY && wranglerExitCode === '0' ? 'notice' : 'warning'
  process.stdout.write(`::${annotation}::W02 tail diagnostic category=${category} wrangler_exit=${wranglerExitCode} sanitizer_exit=${sanitizerExitCode}\n`)
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
