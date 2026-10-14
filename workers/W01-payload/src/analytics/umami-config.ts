export interface UmamiClientConfig {
  scriptUrl: string
  websiteId: string
  domains: string
}

export type UmamiEnvironment = Readonly<Record<string, string | undefined>>

const ALLOWED_DOMAINS = 'luckread.com,www.luckread.com,mp.luckread.com'
const MAX_WEBSITE_ID_LENGTH = 128

/**
 * Resolve browser-safe Umami configuration.
 *
 * The integration is opt-in at build time and fails closed: absent or malformed
 * public configuration never affects the page and never loads third-party code.
 * A website ID and script URL are public identifiers, not secrets.
 */
export function resolveUmamiClientConfig(
  env: UmamiEnvironment,
): UmamiClientConfig | null {
  if (env.NEXT_PUBLIC_UMAMI_ENABLED !== 'true') return null

  const rawScriptUrl = env.NEXT_PUBLIC_UMAMI_SCRIPT_URL?.trim()
  const websiteId = env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim()
  if (!rawScriptUrl || !websiteId || websiteId.length > MAX_WEBSITE_ID_LENGTH) {
    return null
  }

  let scriptUrl: URL
  try {
    scriptUrl = new URL(rawScriptUrl)
  } catch {
    return null
  }

  // Only load Umami's browser tracker over HTTPS. Do not accept credentials,
  // query parameters, or fragments in the configured script URL.
  if (
    scriptUrl.protocol !== 'https:' ||
    !scriptUrl.hostname ||
    scriptUrl.username ||
    scriptUrl.password ||
    scriptUrl.search ||
    scriptUrl.hash ||
    !scriptUrl.pathname.endsWith('/script.js')
  ) {
    return null
  }

  return {
    scriptUrl: scriptUrl.toString(),
    websiteId,
    domains: ALLOWED_DOMAINS,
  }
}
