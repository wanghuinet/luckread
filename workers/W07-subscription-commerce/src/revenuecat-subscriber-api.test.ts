import { describe, expect, it, vi } from 'vitest';
import {
  fetchRevenueCatSubscriber,
  RevenueCatSubscriberApiError,
} from './revenuecat-subscriber-api.js';

const baseSubscriber = {
  original_app_user_id: 'luckread-user-123',
  aliases: ['luckread-user-123', 'rc-alias-1'],
  first_seen: '2026-10-01T00:00:00Z',
  original_purchase_date: '2026-10-02T00:00:00Z',
  management_url: 'https://apps.apple.com/account/subscriptions',
  entitlements: {
    creator_gold: {
      expires_date: '2026-11-02T00:00:00Z',
      grace_period_expires_date: '2026-11-05T00:00:00Z',
      product_identifier: 'creator.gold:monthly-v1',
      purchase_date: '2026-10-02T00:00:00Z',
    },
  },
  subscriptions: {
    'creator.gold:monthly-v1': {
      expires_date: '2026-11-02T00:00:00Z',
      grace_period_expires_date: '2026-11-05T00:00:00Z',
      purchase_date: '2026-10-02T00:00:00Z',
      is_sandbox: false,
      store: 'app_store',
      store_transaction_id: 123456789012345,
      unsubscribe_detected_at: null,
      refunded_at: null,
    },
  },
};

const okResponse = (subscriber: unknown = baseSubscriber, status = 200) => new Response(
  JSON.stringify({
    request_date: '2026-10-30T00:00:00Z',
    request_date_ms: 1793328000000,
    subscriber,
  }),
  { status, headers: { 'content-type': 'application/json' } },
);

describe('RevenueCat read-only subscriber API adapter', () => {
  it('fails before network access when the server secret is missing', async () => {
    const fetcher = vi.fn();
    await expect(fetchRevenueCatSubscriber(
      { appUserId: 'luckread-user-123', secretApiKey: undefined },
      { fetcher: fetcher as unknown as typeof fetch },
    )).rejects.toMatchObject({
      code: 'CONFIGURATION_REQUIRED',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects empty, non-canonical and control-character App User IDs', async () => {
    for (const appUserId of ['', ' user-1', 'user-1\nforged', 'x'.repeat(256)]) {
      await expect(fetchRevenueCatSubscriber(
        { appUserId, secretApiKey: 'sk_revenuecat_secret' },
        { fetcher: vi.fn() as unknown as typeof fetch },
      )).rejects.toMatchObject({ code: 'INVALID_APP_USER_ID' });
    }
  });

  it('uses the server-side bearer key and URL-encodes the App User ID without mutating it', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      return okResponse();
    }) as unknown as typeof fetch;

    const snapshot = await fetchRevenueCatSubscriber(
      { appUserId: 'luckread/user + 1', secretApiKey: 'sk_server_only_secret' },
      { fetcher, now: () => Date.parse('2026-10-30T00:00:00Z') },
    );

    expect(requestedUrl).toBe(
      'https://api.revenuecat.com/v1/subscribers/luckread%2Fuser%20%2B%201',
    );
    expect(requestedInit?.method).toBe('GET');
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer sk_server_only_secret');
    expect(new Headers(requestedInit?.headers).get('accept')).toBe('application/json');
    expect(new Headers(requestedInit?.headers).has('x-platform')).toBe(false);
    expect(snapshot.queriedAppUserId).toBe('luckread/user + 1');
    expect(snapshot.originalAppUserId).toBe('luckread-user-123');
    expect(snapshot.aliases).toEqual(['luckread-user-123', 'rc-alias-1']);
    expect(snapshot.customerCreatedOnLookup).toBe(false);
  });

  it('returns allowlisted entitlement and subscription fields without losing numeric transaction IDs', async () => {
    const fetcher = vi.fn(async () => okResponse()) as unknown as typeof fetch;
    const snapshot = await fetchRevenueCatSubscriber(
      { appUserId: 'luckread-user-123', secretApiKey: 'sk_server_only_secret' },
      { fetcher },
    );

    expect(snapshot.entitlements.creator_gold).toMatchObject({
      product_identifier: 'creator.gold:monthly-v1',
      grace_period_expires_date: '2026-11-05T00:00:00Z',
    });
    expect(snapshot.subscriptions['creator.gold:monthly-v1']).toMatchObject({
      store: 'app_store',
      store_transaction_id: 123456789012345,
      is_sandbox: false,
      refunded_at: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain('subscriber_attributes');
  });

  it('marks the RevenueCat get-or-create 201 response as a newly created empty customer', async () => {
    const fetcher = vi.fn(async () => okResponse({
      original_app_user_id: 'new-luckread-user',
      entitlements: {},
      subscriptions: {},
    }, 201)) as unknown as typeof fetch;

    const snapshot = await fetchRevenueCatSubscriber(
      { appUserId: 'new-luckread-user', secretApiKey: 'sk_server_only_secret' },
      { fetcher },
    );

    expect(snapshot.customerCreatedOnLookup).toBe(true);
    expect(snapshot.originalAppUserId).toBe('new-luckread-user');
    expect(snapshot.entitlements).toEqual({});
    expect(snapshot.subscriptions).toEqual({});
  });

  it('classifies rate limits and upstream outages as retryable without exposing response bodies', async () => {
    const rateLimited = vi.fn(async () => new Response('private upstream detail', {
      status: 429,
      headers: { 'retry-after': '17' },
    })) as unknown as typeof fetch;
    await expect(fetchRevenueCatSubscriber(
      { appUserId: 'user-1', secretApiKey: 'sk_server_only_secret' },
      { fetcher: rateLimited },
    )).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      upstreamStatus: 429,
      retryAfterSeconds: 17,
    });

    const unavailable = vi.fn(async () => new Response('private upstream detail', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchRevenueCatSubscriber(
      { appUserId: 'user-1', secretApiKey: 'sk_server_only_secret' },
      { fetcher: unavailable },
    )).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      retryable: true,
      upstreamStatus: 503,
    });
  });

  it('rejects malformed snapshots and response bodies above the configured cap', async () => {
    const malformed = vi.fn(async () => new Response('{"subscriber":{"subscriptions":[]}}', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchRevenueCatSubscriber(
      { appUserId: 'user-1', secretApiKey: 'sk_server_only_secret' },
      { fetcher: malformed },
    )).rejects.toBeInstanceOf(RevenueCatSubscriberApiError);

    const oversized = vi.fn(async () => okResponse(baseSubscriber)) as unknown as typeof fetch;
    await expect(fetchRevenueCatSubscriber(
      { appUserId: 'user-1', secretApiKey: 'sk_server_only_secret' },
      { fetcher: oversized, maxResponseBytes: 32 },
    )).rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false });
  });

  it('treats bad server credentials as a non-retryable configuration rejection', async () => {
    const fetcher = vi.fn(async () => new Response('do not expose this body', { status: 401 })) as unknown as typeof fetch;
    await expect(fetchRevenueCatSubscriber(
      { appUserId: 'user-1', secretApiKey: 'sk_server_only_secret' },
      { fetcher },
    )).rejects.toMatchObject({
      code: 'UPSTREAM_REJECTED',
      retryable: false,
      upstreamStatus: 401,
    });
  });
});
