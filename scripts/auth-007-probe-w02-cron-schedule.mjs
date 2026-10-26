const EXPECTED_CRON = '* * * * *'

const CATEGORIES = Object.freeze({
  CONFIG: 'CONFIGURATION_MISSING',
  AUTH: 'AUTH_OR_PERMISSION',
  SCOPE: 'WORKER_OR_SCOPE_NOT_FOUND',
  RATE: 'RATE_LIMITED',
  API: 'CLOUDFLARE_API_FAILURE_REDACTED',
  HTTP: 'HTTP_FAILURE_DETAILS_REDACTED',
  CRON: 'EXPECTED_CRON_NOT_REGISTERED',
  NETWORK: 'NETWORK_OR_CONNECTION',
})

/**
 * Read the deployed W02 Cron Trigger schedule without changing Worker settings.
 * Never log or persist response bodies, credentials, timestamps, or other
 * schedule expressions; retain only aggregate facts and fixed categories.
 */
export async function probeW02CronSchedule({
  accountId,
  apiToken,
  fetchImpl = globalThis.fetch,
}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') ||
      typeof apiToken !== 'string' || apiToken.length < 20 ||
      typeof fetchImpl !== 'function') {
    return {
      status: 'FAIL',
      category: CATEGORIES.CONFIG,
      httpStatus: 'NONE',
      scheduleCount: 0,
      expectedCronPresent: false,
    }
  }

  let response
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/luckread-w02/schedules`,
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
    return {
      status: 'FAIL',
      category: CATEGORIES.NETWORK,
      httpStatus: 'NONE',
      scheduleCount: 0,
      expectedCronPresent: false,
    }
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
    return {
      status: 'FAIL',
      category,
      httpStatus: response.status,
      scheduleCount: 0,
      expectedCronPresent: false,
    }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return {
      status: 'FAIL',
      category: CATEGORIES.API,
      httpStatus: response.status,
      scheduleCount: 0,
      expectedCronPresent: false,
    }
  }

  if (payload?.success !== true || !Array.isArray(payload.result?.schedules)) {
    return {
      status: 'FAIL',
      category: CATEGORIES.API,
      httpStatus: response.status,
      scheduleCount: 0,
      expectedCronPresent: false,
    }
  }

  const schedules = payload.result.schedules
  const expectedCronPresent = schedules.some((schedule) =>
    schedule && typeof schedule === 'object' && schedule.cron === EXPECTED_CRON)
  return {
    status: expectedCronPresent ? 'PASS' : 'FAIL',
    category: expectedCronPresent ? 'NONE' : CATEGORIES.CRON,
    httpStatus: response.status,
    scheduleCount: schedules.length,
    expectedCronPresent,
  }
}

async function main() {
  const result = await probeW02CronSchedule({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_AUTH007_READONLY_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN,
  })
  process.stdout.write(
    `W02_CRON_SCHEDULE_PREFLIGHT status=${result.status} category=${result.category} http_status=${result.httpStatus} schedule_count=${result.scheduleCount} expected_cron_present=${result.expectedCronPresent}\n`,
  )
  if (result.status !== 'PASS') process.exitCode = 1
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
