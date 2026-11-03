export type VideoPlaybackSource = {
  uri: string;
  headers?: Record<string, string>;
};

export type VideoPlaybackResult = {
  source: VideoPlaybackSource | null;
  error?: string;
};

type VideoFeedEnrichmentTasks<Body, Social, Author> = {
  body: () => Promise<Body>;
  social: () => Promise<Social>;
  author: () => Promise<Author>;
  playback: () => Promise<VideoPlaybackResult>;
};

type VideoFeedEnrichmentFallbacks<Social, Author> = {
  social: Social;
  author: Author;
};

function describeFailure(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : fallback;
}

/**
 * Treat body, social, author and playback as independent optional reads.
 * A failure in one source must not discard the other successful enrichments
 * or the metadata already returned by the canonical video feed endpoint.
 */
export async function settleVideoFeedEnrichment<Body, Social, Author>(
  tasks: VideoFeedEnrichmentTasks<Body, Social, Author>,
  fallbacks: VideoFeedEnrichmentFallbacks<Social, Author>,
): Promise<{
  body: Body | undefined;
  social: Social;
  author: Author;
  playback: VideoPlaybackResult;
}> {
  const [body, social, author, playback] = await Promise.allSettled([
    Promise.resolve().then(() => tasks.body()),
    Promise.resolve().then(() => tasks.social()),
    Promise.resolve().then(() => tasks.author()),
    Promise.resolve().then(() => tasks.playback()),
  ]);

  return {
    body: body.status === 'fulfilled' ? body.value : undefined,
    social: social.status === 'fulfilled' ? social.value : fallbacks.social,
    author: author.status === 'fulfilled' ? author.value : fallbacks.author,
    playback: playback.status === 'fulfilled'
      ? playback.value
      : {
          source: null,
          error: describeFailure(playback.reason, 'Unable to authorize video playback.'),
        },
  };
}
