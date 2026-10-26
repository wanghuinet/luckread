import { probeW02ScheduledAnalytics } from './auth-007-probe-w02-observability.mjs'

async function main() {
  const result = await probeW02ScheduledAnalytics({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  })
  const observed = result.scheduledAnalyticsStatus === 'PASS' && result.scheduledAnalyticsRows > 0
  process.stdout.write(
    `W02_SCHEDULED_ANALYTICS_PREFLIGHT status=${result.scheduledAnalyticsStatus} category=${result.scheduledAnalyticsCategory} http_status=${result.scheduledAnalyticsHttpStatus} rows=${result.scheduledAnalyticsRows} scheduled_execution_observed=${observed}\\n`,
  )
  if (!observed) process.exitCode = 1
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
