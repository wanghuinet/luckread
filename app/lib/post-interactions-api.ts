import { apiRequest, getApiErrorMessage } from './api-client';
import { firstNonNegativeInteger } from './api-value';

export type ContentLike = {
  userId: string;
  likedAt: string;
};

export type ContentLikesPage = {
  items: ContentLike[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type PostInteractionSummary = {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  viewCount?: number;
};

type RecordLike = Record<string, unknown>;

function requireContentId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    throw new TypeError('A valid content ID is required.');
  }
  return normalized;
}

function asRecord(value: unknown): RecordLike | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordLike
    : null;
}

function unwrap(value: unknown): RecordLike | null {
  let record = asRecord(value);
  // W01 endpoints commonly use { data }, while a legacy content envelope can use { doc }.
  for (let depth = 0; depth < 2 && record; depth += 1) {
    if (Object.prototype.hasOwnProperty.call(record, 'data')) {
      record = asRecord(record.data);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(record, 'doc')) {
      record = asRecord(record.doc);
      continue;
    }
    break;
  }
  return record;
}



export async function fetchContentLikesPage(
  contentId: string,
  options: { cursor?: string | null; signal?: AbortSignal } = {},
): Promise<ContentLikesPage> {
  const id = requireContentId(contentId);
  const query = new URLSearchParams({ limit: '20' });
  if (typeof options.cursor === 'string' && options.cursor.trim()) {
    query.set('cursor', options.cursor);
  }

  const result = await apiRequest<unknown>(
    '/contents/' + encodeURIComponent(id) + '/likes?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
  if (!result.response.ok) {
    throw new Error(result.error?.message || getApiErrorMessage(
      result.data,
      'Could not load people who liked this post. Please try again.',
      result.response.status,
    ));
  }

  const envelope = asRecord(result.data);
  const payload = envelope && Object.prototype.hasOwnProperty.call(envelope, 'data')
    ? asRecord(envelope.data)
    : envelope;
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error('The likes response was not in the expected format.');
  }

  const items = payload.items
    .map((raw) => {
      const item = asRecord(raw);
      const userId = typeof item?.userId === 'string' ? item.userId.trim() : '';
      const likedAt = typeof item?.likedAt === 'string' ? item.likedAt : '';
      return userId && likedAt ? { userId, likedAt } : null;
    })
    .filter((item): item is ContentLike => item !== null);

  return {
    items,
    nextCursor: typeof payload.nextCursor === 'string' && payload.nextCursor
      ? payload.nextCursor
      : null,
    hasMore: payload.hasMore === true,
  };
}

export async function fetchPostInteractionSummary(
  contentId: string,
  signal?: AbortSignal,
): Promise<PostInteractionSummary> {
  const id = requireContentId(contentId);
  const encodedId = encodeURIComponent(id);
  const contentResult = await apiRequest<unknown>(
    '/contents/' + encodedId,
    { method: 'GET', signal },
  );
  if (!contentResult.response.ok) {
    throw new Error(contentResult.error?.message || getApiErrorMessage(
      contentResult.data,
      'Could not load this post. Please try again.',
      contentResult.response.status,
    ));
  }

  const content = unwrap(contentResult.data);
  if (!content || typeof content.id !== 'string' || content.id !== id) {
    throw new Error('The content service did not return the requested post.');
  }

  let social: RecordLike | null = null;
  try {
    const socialResult = await apiRequest<unknown>(
      '/contents/' + encodedId + '/social',
      { method: 'GET', signal },
    );
    if (socialResult.response.ok) social = unwrap(socialResult.data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    // The content response can still provide canonical counts when social is unavailable.
  }

  const contentCounts = asRecord(content.counts) ?? {};
  const embeddedSocial = asRecord(content.social);
  const embeddedCounts = asRecord(embeddedSocial?.counts) ?? {};
  const socialCounts = asRecord(social?.counts) ?? {};
  const counts = { ...contentCounts, ...embeddedCounts, ...socialCounts };

  const summary: PostInteractionSummary = {};
  const likes = firstNonNegativeInteger(counts.likes, content.likeCount, content.like_count);
  const reposts = firstNonNegativeInteger(counts.reposts, counts.retweets, content.repostCount, content.retweetCount, content.retweet_count);
  const replies = firstNonNegativeInteger(counts.replies, counts.comments, content.replyCount, content.reply_count);
  const views = firstNonNegativeInteger(counts.views, content.viewCount, content.view_count);

  if (likes !== undefined) summary.likeCount = likes;
  if (reposts !== undefined) summary.repostCount = reposts;
  if (replies !== undefined) summary.replyCount = replies;
  if (views !== undefined) summary.viewCount = views;
  return summary;
}
