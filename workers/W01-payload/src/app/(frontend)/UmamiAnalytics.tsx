import Script from 'next/script'

import { resolveUmamiClientConfig } from '@/analytics/umami-config'

/**
 * Reuse Umami's maintained browser tracker for generic web-traffic analytics.
 * No W11 business event is derived from this client-side telemetry.
 *
 * NEXT_PUBLIC_* values are read through direct property access so Next.js can
 * inline the public build-time settings correctly for the deployed Worker.
 * Collection remains off until deliberately enabled after privacy/consent review.
 */
export default function UmamiAnalytics() {
  const config = resolveUmamiClientConfig({
    NEXT_PUBLIC_UMAMI_ENABLED: process.env.NEXT_PUBLIC_UMAMI_ENABLED,
    NEXT_PUBLIC_UMAMI_SCRIPT_URL: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
  })
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
