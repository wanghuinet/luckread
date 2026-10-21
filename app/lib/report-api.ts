import { apiRequest, createIdempotencyKey, getApiErrorMessage } from './api-client';

export const CONTENT_REPORT_REASONS = [
  'ABUSE',
  'SPAM',
  'IMPERSONATION',
  'COPYRIGHT',
  'OTHER',
] as const;

export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number];

export type ContentReportResult = {
  ok: boolean;
  status?: number;
  message?: string;
  deduplicated?: boolean;
};

function isContentReportReason(value: string): value is ContentReportReason {
  return (CONTENT_REPORT_REASONS as readonly string[]).includes(value);
}

/** Submit a content report through W01; W06 remains authoritative for moderation. */
export async function submitContentReport(
  contentIdValue: string,
  reasonValue: string,
  descriptionValue = '',
): Promise<ContentReportResult> {
  const contentId = contentIdValue.trim();
  const reasonCode = reasonValue.trim();
  const description = descriptionValue.trim();

  if (!contentId || contentId.length > 128) {
    return { ok: false, message: 'This post is not connected to a valid LuckRead content ID.' };
  }
  if (!isContentReportReason(reasonCode)) {
    return { ok: false, message: 'Choose a valid reason for reporting this post.' };
  }
  if (description.length > 4000) {
    return { ok: false, message: 'The report description cannot exceed 4,000 characters.' };
  }

  try {
    const result = await apiRequest<unknown>('/reports', {
      method: 'POST',
      body: JSON.stringify({
        targetType: 'content',
        targetId: contentId,
        reasonCode,
        ...(description ? { description } : {}),
      }),
      idempotencyKey: 'native-content-report:' + contentId + ':' + createIdempotencyKey(),
    });

    if (!result.response.ok) {
      return {
        ok: false,
        status: result.response.status,
        message: result.error?.message ?? getApiErrorMessage(
          result.data,
          'Could not submit this report. Please try again.',
          result.response.status,
        ),
      };
    }

    const envelope = result.data && typeof result.data === 'object' && 'data' in result.data
      ? (result.data as { data?: unknown }).data
      : null;
    if (!envelope || typeof envelope !== 'object') {
      return {
        ok: false,
        status: result.response.status,
        message: 'LuckRead did not confirm the report. Refresh and check before retrying.',
      };
    }

    const status = (envelope as { status?: unknown }).status;
    return {
      ok: true,
      status: result.response.status,
      deduplicated: status === 'DEDUPLICATED',
    };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error
        ? cause.message
        : 'Could not submit this report. Please check your connection and try again.',
    };
  }
}
