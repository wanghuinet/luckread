import { apiRequest, createIdempotencyKey, getApiBaseUrl, getApiErrorMessage } from './api-client';

export type LocalMediaFile = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
};

export type UploadedMedia = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  filesize?: number | null;
};

export type MediaPlayback = UploadedMedia & {
  status: 'READY';
};

type MediaEnvelope = {
  doc?: unknown;
  data?: unknown;
  id?: string | number;
  url?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  filesize?: number | null;
  status?: string;
  error?: { message?: string };
};

type MediaApiResult = {
  response: Response;
  data: unknown;
  error: { message: string; code?: string; requestId?: string } | null;
};

/** Preserve server correlation details so a failed media write can be traced in W01 logs. */
function apiFailureMessage(result: MediaApiResult, fallback: string): string {
  const message = result.error?.message ||
    getApiErrorMessage(result.data, fallback, result.response.status);
  const diagnostic = ['HTTP ' + result.response.status];
  if (result.error?.code) diagnostic.push(result.error.code);
  if (result.error?.requestId) diagnostic.push('Request ID ' + result.error.requestId);
  return message + ' (' + diagnostic.join('; ') + ')';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unwrapMedia(value: unknown): Record<string, unknown> | null {
  const root = record(value);
  if (!root) return null;
  const data = record(root.data);
  const doc = record(root.doc) ?? record(data?.doc);
  return doc ?? data ?? root;
}

/** Stable, non-secret fingerprint for one upload attempt (never sends a local URI). */
function uploadFingerprint(parts: Array<string | number | null>): string {
  const value = JSON.stringify(parts);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return 'lr-up1-' +
    (first >>> 0).toString(16).padStart(8, '0') +
    (second >>> 0).toString(16).padStart(8, '0');
}

function toServerUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), getApiBaseUrl());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeUploadedMedia(value: unknown): UploadedMedia | null {
  const media = unwrapMedia(value);
  if (!media) return null;

  const id = typeof media.id === 'string' || typeof media.id === 'number'
    ? String(media.id)
    : '';
  const url = toServerUrl(media.url);
  if (!id.trim() || !url) return null;

  return {
    id,
    url,
    filename: typeof media.filename === 'string' && media.filename.trim()
      ? media.filename
      : 'LuckRead media',
    mimeType: typeof media.mimeType === 'string' && media.mimeType.trim()
      ? media.mimeType
      : 'application/octet-stream',
    filesize: typeof media.filesize === 'number' ? media.filesize : null,
  };
}

export async function uploadMediaFile(
  file: LocalMediaFile,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<UploadedMedia> {
  if (!file.uri || !file.name || !file.mimeType) {
    throw new Error('The selected media file is missing its URI or file information.');
  }
  const form = new FormData();
  form.append('_payload', JSON.stringify({ alt: file.name }));
  // React Native's FormData implementation recognizes this { uri, name, type }
  // part and streams the device file. The URI is never saved as a content URL.
  const filePart = {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob;
  form.append('file', filePart);

  const result = await apiRequest<MediaEnvelope>('/media', {
    method: 'POST',
    body: form,
    idempotencyKey,
    headers: {
      'X-LuckRead-Upload-Fingerprint': uploadFingerprint([
        'file',
        file.uri,
        file.name,
        file.mimeType,
        file.size ?? null,
      ]),
    },
  });
  if (!result.response.ok) {
    throw new Error(apiFailureMessage(result, 'Media upload failed. Please retry.'));
  }

  const media = normalizeUploadedMedia(result.data);
  if (!media) {
    throw new Error('The media service did not return a permanent media ID and server URL.');
  }
  return media;
}

export async function uploadTextBody(
  text: string,
  idempotencyKey: string = createIdempotencyKey(),
): Promise<UploadedMedia> {
  if (!text.trim()) throw new Error('Post text cannot be empty.');
  const fileName = 'luckread-post-' + idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) + '.txt';
  const form = new FormData();
  form.append('_payload', JSON.stringify({ alt: fileName }));
  form.append('file', new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName);

  const result = await apiRequest<MediaEnvelope>('/media', {
    method: 'POST',
    body: form,
    idempotencyKey,
    headers: {
      'X-LuckRead-Upload-Fingerprint': uploadFingerprint([
        'text',
        fileName,
        'text/plain;charset=utf-8',
        text,
      ]),
    },
  });
  if (!result.response.ok) {
    throw new Error(apiFailureMessage(result, 'Post body upload failed. Please retry.'));
  }

  const media = normalizeUploadedMedia(result.data);
  if (!media) {
    throw new Error('The media service did not return a permanent URL for the post body.');
  }
  return media;
}

export async function getMediaPlayback(mediaId: string): Promise<MediaPlayback> {
  if (!mediaId.trim()) throw new Error('A server media ID is required to resolve playback.');
  const result = await apiRequest<MediaEnvelope>(
    '/media/' + encodeURIComponent(mediaId) + '/playback',
    { method: 'GET' },
  );
  if (!result.response.ok) {
    throw new Error(apiFailureMessage(result, 'The server could not authorize media playback.'));
  }

  const media = normalizeUploadedMedia(result.data);
  const raw = unwrapMedia(result.data);
  if (!media || (raw?.status !== undefined && raw.status !== 'READY')) {
    throw new Error('This media is not ready for playback yet.');
  }
  return { ...media, status: 'READY' };
}
