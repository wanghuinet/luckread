import { describe, expect, it } from 'vitest'
import { resolveUmamiClientConfig } from './umami-config'

const validEnvironment = {
  NEXT_PUBLIC_UMAMI_ENABLED: 'true',
  NEXT_PUBLIC_UMAMI_SCRIPT_URL: 'https://analytics.example.com/script.js',
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'site-public-id',
}

describe('resolveUmamiClientConfig', () => {
  it('keeps analytics disabled unless explicitly enabled', () => {
    expect(resolveUmamiClientConfig({})).toBeNull()
    expect(resolveUmamiClientConfig({
      ...validEnvironment,
      NEXT_PUBLIC_UMAMI_ENABLED: 'false',
    })).toBeNull()
  })

  it('stays disabled when either public configuration value is absent', () => {
    expect(resolveUmamiClientConfig({
      ...validEnvironment,
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: undefined,
    })).toBeNull()
    expect(resolveUmamiClientConfig({
      ...validEnvironment,
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: ' ',
    })).toBeNull()
  })

  it('returns the public tracker config and limits it to production LuckRead domains', () => {
    expect(resolveUmamiClientConfig(validEnvironment)).toEqual({
      scriptUrl: 'https://analytics.example.com/script.js',
      websiteId: 'site-public-id',
      domains: 'luckread.com,www.luckread.com,mp.luckread.com',
    })
  })

  it.each([
    'http://analytics.example.com/script.js',
    'javascript://analytics.example.com/script.js',
    'https://user:password@analytics.example.com/script.js',
    'https://analytics.example.com/script.js?token=secret',
    'https://analytics.example.com/not-the-tracker.js',
  ])('rejects an unsafe or unexpected script URL: %s', (scriptUrl) => {
    expect(resolveUmamiClientConfig({
      ...validEnvironment,
      NEXT_PUBLIC_UMAMI_SCRIPT_URL: scriptUrl,
    })).toBeNull()
  })

  it('rejects an empty or overlong website ID', () => {
    expect(resolveUmamiClientConfig({
      ...validEnvironment,
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: '',
    })).toBeNull()
    expect(resolveUmamiClientConfig({
      ...validEnvironment,
      NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'x'.repeat(129),
    })).toBeNull()
  })
})
