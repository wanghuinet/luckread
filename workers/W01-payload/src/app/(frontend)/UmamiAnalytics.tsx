import Script from 'next/script'

import { resolveUmamiClientConfig } from '@/analytics/umami-config'

/**
 * Reuse Umami's maintained browser tracker for generic web-traffic analytics.
 * No W11 business event is derived from this client-side telemetry.
 *
 * Production collection remains off until deployment config is deliberately
 * enabled after the applicable privacy/consent review. Tracker failure is
 * isolated from registration, reading, publishing, and social interactions.
 */
export default function UmamiAnalytics() {
  const config = resolveUmamiClientConfig(process.env)
  if (!config) return null

  return (
    <Script
      src={config.scriptUrl}
      data-website-id={config.websiteId}
      data-domains={config.domains}
      data-exclude-search="true"
      data-exclude-hash="true"
      data-do-not-track="true"
      strategy="afterInteractive"
    />
  )
}
