import { apiRequest, createIdempotencyKey } from './api-client';

export type ContentShareLinkResult =
  | { ok: true; url: string }
  | { ok: false; status?: number; message: string };

const PUBLIC_SHARE_ORIGIN = 'https://luckread.com';

function getShareId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('shareId' in data)) return null;
  const shareId = (data as { shareId?: unknown }).shareId;
  return typeof shareId === 'string' && shareId.trim() ? shareId.trim() : null;
}

/** Create an authoritative W01/W05 share and return its public landing URL. */
export async function createContentShareLink(contentId?: string): Promise<ContentShareLinkResult> {
  const id = typeof contentId === 'string' ? contentId.trim() : '';
  if (!id) {
    return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  }

  try {
    const result = await apiRequest<unknown>(
      '/content/' + encodeURIComponent(id) + '/shares',
      {
        method: 'POST',
        body: JSON.stringify({ contentId: id }),
        idempotencyKey: createIdempotencyKey(),
      },
    );

    if (!result.response.ok) {
      return {
        ok: false,
        status: result.response.status,
        message: result.error?.message ?? 'Could not create a share link. Please try again.',
      };
    }

    const shareId = getShareId(result.data);
    if (!shareId) {
      return {
        ok: false,
        status: result.response.status,
        message: 'LuckRead did not return a valid share link. Please try again.',
      };
    }

    return {
      ok: true,
      url: PUBLIC_SHARE_ORIGIN + '/s/' + encodeURIComponent(shareId),
    };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error
        ? cause.message
        : 'Could not reach LuckRead. Check your connection and try again.',
    };
  }
}
