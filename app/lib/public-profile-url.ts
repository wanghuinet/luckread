const PUBLIC_PROFILE_ORIGIN = 'https://luckread.com';

/**
 * Build the canonical public profile URL from the W01/Payload user row ID.
 * The Better Auth identity ID is intentionally not accepted implicitly.
 */
export function buildPublicProfileUrl(profileId: unknown): string | null {
  if (typeof profileId !== 'string') return null;
  const id = profileId.trim();
  if (!id || id.length > 128) return null;
  return PUBLIC_PROFILE_ORIGIN + '/users/' + encodeURIComponent(id);
}
