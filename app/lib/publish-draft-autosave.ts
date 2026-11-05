export const AUTO_SAVE_DEBOUNCE_MS = 1_800;
export const AUTO_SAVE_MIN_INTERVAL_MS = 5_000;

export function createReplyAudienceFingerprint(text: string, audience: string): string {
  const normalized = JSON.stringify([text.trim().normalize('NFKC'), audience]);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return 'lr-reply1-' +
    (first >>> 0).toString(16).padStart(8, '0') +
    (second >>> 0).toString(16).padStart(8, '0');
}

export type PublishDraftFingerprintInput = {
  body: string;
  accessMode: 'PUBLIC' | 'MEMBERS_ONLY';
  mediaRefs: string[];
  coverRef: string | null;
  pollEnabled: boolean;
  pollOptions: string[];
  pollDurationMinutes: number;
};

/** Match the proven W01 web composer cadence: debounce typing and cap write frequency. */
export function computeAutoSaveDelay(now: number, lastSavedAt: number | null): number {
  if (lastSavedAt === null) return AUTO_SAVE_DEBOUNCE_MS;
  return Math.max(
    AUTO_SAVE_DEBOUNCE_MS,
    AUTO_SAVE_MIN_INTERVAL_MS - Math.max(0, now - lastSavedAt),
  );
}

/** Non-reversible in-memory fingerprint; never persist or log draft text. */
export function createPublishDraftFingerprint(input: PublishDraftFingerprintInput): string {
  const normalized = JSON.stringify([
    input.body.trim(),
    input.accessMode,
    input.mediaRefs,
    input.coverRef,
    input.pollEnabled,
    input.pollEnabled ? input.pollOptions.map((option) => option.normalize('NFKC').trim()) : [],
    input.pollEnabled ? input.pollDurationMinutes : null,
  ]);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return 'lr-pdraft1-' +
    (first >>> 0).toString(16).padStart(8, '0') +
    (second >>> 0).toString(16).padStart(8, '0');
}
