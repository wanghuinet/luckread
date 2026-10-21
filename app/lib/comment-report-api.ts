import { apiRequest, getApiErrorMessage } from './api-client';

export const COMMENT_REPORT_REASONS = [
  { code: 'ABUSE', label: 'Abuse or harassment' },
  { code: 'SPAM', label: 'Spam or misleading' },
  { code: 'IMPERSONATION', label: 'Impersonation' },
  { code: 'COPYRIGHT', label: 'Copyright violation' },
  { code: 'OTHER', label: 'Other' },
] as const;

export type CommentReportReason = typeof COMMENT_REPORT_REASONS[number]['code'];

export class CommentReportApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CommentReportApiError';
  }
}

export type CommentReportResult = {
  status: 'SUBMITTED' | 'DEDUPLICATED';
};

function normalizeId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) throw new TypeError('A valid comment ID is required.');
  return id;
}

function normalizeReason(value: string): CommentReportReason {
  const reason = COMMENT_REPORT_REASONS.find((item) => item.code === value);
  if (!reason) throw new TypeError('Choose a valid report reason.');
  return reason.code;
}

export async function reportComment(input: {
  commentId: string;
  reasonCode: string;
  description?: string;
  idempotencyKey: string;
}): Promise<CommentReportResult> {
  const commentId = normalizeId(input.commentId);
  const reasonCode = normalizeReason(input.reasonCode);
  const description = input.description?.trim();
  const key = input.idempotencyKey.trim();

  if (description && description.length > 4000) {
    throw new TypeError('The report description must be 4,000 characters or fewer.');
  }
  if (!key || key.length > 256) {
    throw new TypeError('A valid idempotency key is required.');
  }

  const result = await apiRequest<unknown>('/reports', {
    method: 'POST',
    idempotencyKey: key,
    body: JSON.stringify({
      targetType: 'comment',
      targetId: commentId,
      reasonCode,
      ...(description ? { description } : {}),
    }),
  });

  if (!result.response.ok) {
    throw new CommentReportApiError(
      result.error?.message || getApiErrorMessage(
        result.data,
        'Could not submit the comment report. Please try again.',
        result.response.status,
      ),
      result.response.status,
      result.error?.code,
    );
  }

  const envelope = result.data !== null && typeof result.data === 'object'
    ? result.data as { data?: unknown }
    : null;
  const payload = envelope?.data !== null && typeof envelope?.data === 'object'
    ? envelope.data as { status?: unknown }
    : null;
  return {
    status: payload?.status === 'DEDUPLICATED' ? 'DEDUPLICATED' : 'SUBMITTED',
  };
}
