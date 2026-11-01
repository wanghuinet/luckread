import type { FeedContent, FeedMediaAttachment } from '~/components/FeedItem';
import { apiRequest, fetchContentBodyReference, getApiBaseUrl } from './api-client';
import { firstNonNegativeInteger } from './api-value';

export type ApiAuthor = {
  id?: string;
  userId?: string;
  username?: string;
  handle?: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
};

export type ApiPublicProfile = {
  id: string;
  identityId?: string | null;
  username?: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
};

export type ApiContentRecord = {
  id: string;
  etag?: string;
  ownerUserId?: string;
  creatorId?: string | null;
  contentType?: 'article' | 'post' | 'video' | string;
  state?: string;
  title?: string;
  body?: string | null;
  bodyText?: string | null;
  text?: string | null;
  summary?: string | null;
  excerpt?: string | null;
  description?: string | null;
  bodyRef?: string | null;
  createdAt?: string;
  updatedAt?: string;
  coverRef?: string | null;
  mediaRefs?: string[];
  author?: ApiAuthor | null;
  creator?: ApiAuthor | null;
  counts?: ApiContentCounts | null;
  social?: ApiContentSocial | null;
  likeCount?: number;
  like_count?: number;
  retweetCount?: number;
  retweet_count?: number;
  replyCount?: number;
  reply_count?: number;
  viewCount?: number | string;
  view_count?: number | string;
  saveCount?: number;
  save_count?: number;
};

export type ApiContentCounts = {
  likes?: number;
  comments?: number;
  replies?: number;
  retweets?: number;
  reposts?: number;
  views?: number;
  favorites?: number;
  shares?: number;
  saves?: number;
};

export type ApiContentSocial = {
  counts?: ApiContentCounts;
  viewer?: { liked?: boolean; favorited?: boolean } | null;
};

export type ApiContentPage = {
  items: ApiContentRecord[];
  nextCursor?: string | null;
  hasMore?: boolean;
  candidateWindowTruncated?: boolean;
};

export function unwrapApiData<T>(value: unknown): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, 'data')) {
    return (record.data ?? null) as T | null;
  }
  return record as T;
}

/**
 * Resolve a profile using either its Payload profile ID or a Better Auth
 * identity ID. These IDs can differ; the second existing route performs the
 * profile projection lookup without exposing the identity mapping.
 */
export async function resolvePublicProfileById(
  userId: string,
  signal?: AbortSignal,
): Promise<ApiPublicProfile | null> {
  const normalizedId = userId.trim();
  if (!normalizedId || normalizedId.length > 128) return null;

  const paths = [
    '/users/' + encodeURIComponent(normalizedId),
    '/users/by-identity-id/' + encodeURIComponent(normalizedId),
  ];
  for (const path of paths) {
    try {
      const result = await apiRequest<unknown>(path, {
        method: 'GET',
        auth: false,
        signal,
      });
      if (signal?.aborted) return null;
      if (!result.response.ok) continue;
      const profile = unwrapApiData<ApiPublicProfile>(result.data);
      if (profile && typeof profile.id === 'string' && profile.id.trim()) return profile;
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return null;
    }
  }
  return null;
}


function resolveMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const reference = value.trim();

  // Media references may use the configured W01 API origin or the two approved
  // delivery hosts. Never let an arbitrary absolute URL turn W03 metadata into
  // a client-side delivery path that bypasses the LuckRead media domain policy.
  if (!reference.startsWith('/') && !/^https?:\/\//i.test(reference)) return null;
  if (reference.startsWith('//')) return null;

  try {
    const base = new URL(getApiBaseUrl());
    const resolved = new URL(reference, base);
    const localDevelopmentHost = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    const protocolAllowed = resolved.protocol === 'https:' ||
      (localDevelopmentHost && resolved.origin === base.origin && resolved.protocol === 'http:');
    const approvedDeliveryHost = resolved.protocol === 'https:' &&
      !resolved.port &&
      ['img.luckread.com', 'video.luckread.com'].includes(resolved.hostname);

    if (
      !protocolAllowed ||
      resolved.username ||
      resolved.password ||
      resolved.hash ||
      (resolved.origin !== base.origin && !approvedDeliveryHost)
    ) return null;

    return resolved.toString();
  } catch {
    return null;
  }
}

/** Resolve a media reference for native image/video views without leaking auth off-origin. */
export function resolveNativeMediaSource(
  value: unknown,
  sessionToken?: string | null,
): { uri: string; headers?: Record<string, string> } | null {
  const uri = resolveMediaUrl(value);
  if (!uri) return null;
  if (!sessionToken) return { uri };

  try {
    const baseOrigin = new URL(getApiBaseUrl()).origin;
    if (new URL(uri).origin !== baseOrigin) return { uri };
    return { uri, headers: { Authorization: 'Bearer ' + sessionToken } };
  } catch {
    return { uri };
  }
}

export function mapContentToFeedContent(
  item: ApiContentRecord,
  bodyText?: string,
  social?: ApiContentSocial | null,
  resolvedAuthor?: ApiAuthor | null,
  sessionToken?: string | null,
): FeedContent {
  const creator = { ...(resolvedAuthor ?? {}), ...(item.creator ?? {}), ...(item.author ?? {}) };
  const userId = item.creatorId || item.ownerUserId || creator?.id || creator?.userId || '';
  const createdAt = item.createdAt || item.updatedAt;
  const parsedTime = createdAt ? Date.parse(createdAt) : Number.NaN;
  const postedTime = Number.isFinite(parsedTime) ? Math.floor(parsedTime / 1000) : 0;
  const title = item.title?.trim() || '';
  const accessGranted = item.accessMode !== 'MEMBERS_ONLY' || item.accessGranted === true;
  const bodySource = accessGranted
    ? (bodyText ?? item.bodyText ?? item.body ?? item.text ?? item.excerpt ?? item.summary ?? item.description ?? '')
    : (item.excerpt ?? item.summary ?? item.description ?? '');
  const body = bodySource.trim();
  const message = body && title && body !== title ? title + '\n\n' + body : body || title;
  const cover = accessGranted ? resolveMediaUrl(item.coverRef) ?? undefined : undefined;
  const mediaCandidates = accessGranted ? [
    ...(Array.isArray(item.mediaRefs) ? item.mediaRefs : []),
    ...(cover ? [cover] : []),
  ] : []
    .map(resolveMediaUrl)
    .filter((url): url is string => Boolean(url));
  const mediaItems: FeedMediaAttachment[] = Array.from(new Set(mediaCandidates))
    .slice(0, 4)
    .map((src) => {
      const media = resolveNativeMediaSource(src, sessionToken);
      return {
        src: media?.uri ?? src,
        kind: /\.(?:mp4|webm|mov|m4v|avi|mkv)(?:[?#].*)?$/i.test(src) ? 'video' : 'image',
        ...(media?.headers ? { headers: media.headers } : {}),
      };
    });
  const authorImage = resolveNativeMediaSource(creator?.avatar, sessionToken);
  const authorImageUrl = authorImage?.uri;
  const authorImageHeaders = authorImage?.headers;
  const counts: ApiContentCounts = { ...item.counts, ...item.social?.counts, ...social?.counts };

  return {
    contentId: item.id,
    contentType: item.contentType,
    accessMode: item.accessMode,
    accessGranted,
    etag: item.etag,
    ownerUserId: item.ownerUserId,
    creatorId: item.creatorId,
    poster_id: userId || creator?.username || creator?.handle || 'unknown',
    authorName: creator?.displayName?.trim() || creator?.username || creator?.handle || 'LuckRead member',
    authorHandle: creator?.username || creator?.handle || userId || 'unknown',
    authorImageUrl,
    authorImageHeaders,
    posted_time: postedTime,
    message,
    media_url: cover || mediaItems[0]?.src,
    media_items: mediaItems,
    like_count: firstNonNegativeInteger(counts?.likes, item.likeCount, item.like_count),
    retweet_count: firstNonNegativeInteger(counts?.retweets, counts?.reposts, item.retweetCount, item.retweet_count),
    reply_count: firstNonNegativeInteger(counts?.comments, counts?.replies, item.replyCount, item.reply_count),
    view_count: (() => {
      const count = firstNonNegativeInteger(counts?.views, item.viewCount, item.view_count);
      return count === undefined ? undefined : String(count);
    })(),
    save_count: firstNonNegativeInteger(counts?.favorites, counts?.saves, item.saveCount, item.save_count),
  };
}

/** Read author metadata from W01's public profile API when W03 only returns creatorId/ownerUserId. */
const publicAuthorReads = new Map<string, Promise<ApiAuthor | null>>();

export async function readContentAuthor(item: ApiContentRecord): Promise<ApiAuthor | null> {
  const embedded = item.creator || item.author;
  // W01 list responses include the complete public projection when available.
  // Treat explicit empty fields as a resolved profile too, so an unknown or
  // avatar-less account does not trigger another request for every feed item.
  if (
    embedded &&
    ['username', 'displayName', 'avatar'].every((key) =>
      Object.prototype.hasOwnProperty.call(embedded, key),
    )
  ) return embedded;

  const authorId = item.creatorId || item.ownerUserId || embedded?.id || embedded?.userId;
  if (!authorId) return null;

  let pending = publicAuthorReads.get(authorId);
  if (!pending) {
    pending = (async () => {
      const profile = await resolvePublicProfileById(authorId);
      if (!profile) return null;
      return {
        id: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        avatar: profile.avatar,
      };
    })();
    publicAuthorReads.set(authorId, pending);
    if (publicAuthorReads.size > 200) {
      const oldest = publicAuthorReads.keys().next().value;
      if (oldest) publicAuthorReads.delete(oldest);
    }
  }

  const author = await pending;
  if (!author) publicAuthorReads.delete(authorId);
  return author;
}

/** Read the W05-authoritative interaction summary for the same canonical content ID. */
export async function readContentSocial(
  contentId: string,
  signal?: AbortSignal,
): Promise<ApiContentSocial | null> {
  try {
    const { response, data } = await apiRequest<unknown>(
      '/contents/' + encodeURIComponent(contentId) + '/social',
      { method: 'GET', signal },
    );
    if (!response.ok) return null;
    return unwrapApiData<ApiContentSocial>(data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return null;
  }
}

/**
 * W03 may expose the body directly or by bodyRef. Do not derive a body from a
 * local sample post; if the body is absent, use the real content's summary/title.
 */
export async function readContentBody(
  item: ApiContentRecord,
  signal?: AbortSignal,
  sessionToken?: string | null,
): Promise<string> {
  if (item.accessMode === 'MEMBERS_ONLY' && item.accessGranted !== true) {
    return (item.excerpt ?? item.summary ?? item.description ?? item.title ?? '').trim();
  }

  const directBody = item.bodyText ?? item.body ?? item.text;
  if (typeof directBody === 'string' && directBody.trim()) return directBody.trim();

  const bodyRef = item.bodyRef?.trim();
  if (bodyRef) {
    try {
      // Resolve only HTTP(S) references. Logical storage references such as
      // r2:// are not public URLs and must never be guessed into a delivery URL.
      const base = new URL(getApiBaseUrl());
      const url = new URL(bodyRef, base);
      const localDevelopmentHost = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
      const protocolAllowed = url.protocol === 'https:' ||
        (localDevelopmentHost && url.origin === base.origin && url.protocol === 'http:');
      const trustedHost = url.origin === base.origin ||
        url.hostname === 'luckread.com' || url.hostname.endsWith('.luckread.com');
      if (
        protocolAllowed &&
        trustedHost &&
        !url.username &&
        !url.password &&
        !url.hash
      ) {
        const response = await fetchContentBodyReference(url.toString(), { signal, sessionToken });
        if (response.ok && response.status < 300) {
          const text = (await response.text()).trim();
          if (text) return text;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // A bodyRef failure must not make valid metadata/media unavailable.
    }
  }

  return (item.excerpt ?? item.summary ?? item.description ?? item.title ?? '').trim();
}
