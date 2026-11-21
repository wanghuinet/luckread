const CATEGORIES = Object.freeze({
  AUTH: 'AUTH_OR_PERMISSION',
  SCOPE: 'WORKER_OR_SCOPE_NOT_FOUND',
  RATE: 'RATE_LIMITED',
  API: 'CLOUDFLARE_API_FAILURE_REDACTED',
  NETWORK: 'NETWORK_OR_CONNECTION',
  HTTP: 'HTTP_FAILURE_DETAILS_REDACTED',
  CONFIG: 'CONFIGURATION_MISSING',
})

/**
 * Verify that the configured Cloudflare credential can make the read-only
 * Tail API call for the deployed W02 script. Response bodies and credentials
 * are never logged or persisted.
 */
export async function probeW02TailAccess({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') ||
      typeof apiToken !== 'string' || apiToken.length < 20 ||
      typeof fetchImpl !== 'function') {
    return { status: 'FAIL', category: CATEGORIES.CONFIG, httpStatus: 'NONE', activeTailCount: null }
  }

  let response
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/luckread-w02/tails`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${apiToken}`,
          accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    return { status: 'FAIL', category: CATEGORIES.NETWORK, httpStatus: 'NONE', activeTailCount: null }
  }

  if (!response.ok) {
    const category = response.status === 401 || response.status === 403
      ? CATEGORIES.AUTH
      : response.status === 404
        ? CATEGORIES.SCOPE
        : response.status === 429
          ? CATEGORIES.RATE
          : response.status >= 500
            ? CATEGORIES.API
            : CATEGORIES.HTTP
    return { status: 'FAIL', category, httpStatus: response.status, activeTailCount: null }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return { status: 'FAIL', category: CATEGORIES.API, httpStatus: response.status, activeTailCount: null }
  }

  if (payload?.success === true && Array.isArray(payload.result)) {
    return {
      status: 'PASS',
      category: 'NONE',
      httpStatus: response.status,
      activeTailCount: payload.result.length,
    }
  }
  return { status: 'FAIL', category: CATEGORIES.API, httpStatus: response.status, activeTailCount: null }
}

async function main() {
  const result = await probeW02TailAccess({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  })
  if (result.status === 'PASS') {
    process.stdout.write(`W02_TAIL_ACCESS_PREFLIGHT status=PASS http_status=${result.httpStatus} active_tail_count=${result.activeTailCount ?? 'UNKNOWN'}\n`)
  } else {
    process.stdout.write(
      `::warning::W02_TAIL_ACCESS_PREFLIGHT status=FAIL category=${result.category} http_status=${result.httpStatus} active_tail_count=${result.activeTailCount ?? 'UNKNOWN'}\n`,
    )
    process.exitCode = 1
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
