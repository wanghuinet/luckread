export type ComposerTokenKind = 'mention' | 'topic';

export type ActiveComposerToken = {
  kind: ComposerTokenKind;
  prefix: '@' | '#';
  query: string;
  start: number;
  end: number;
};

export type TextSelectionRange = { start: number; end: number };

/** Find an unfinished @handle or #topic immediately before the native input caret. */
export function findActiveComposerToken(text: string, selectionStart: number): ActiveComposerToken | null {
  const cursor = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)));
  const beforeCursor = text.slice(0, cursor);
  const match = /(^|[\\s([{])([@#])([\\p{L}\\p{N}_-]{0,64})$/u.exec(beforeCursor);
  if (!match) return null;
  const prefix = match[2] as '@' | '#';
  return {
    kind: prefix === '@' ? 'mention' : 'topic',
    prefix,
    query: match[3] ?? '',
    start: cursor - match[0].length + (match[1]?.length ?? 0),
    end: cursor,
  };
}

/** Replace the active token without disturbing the text surrounding its selection. */
export function replaceActiveComposerToken(
  text: string,
  token: ActiveComposerToken,
  value: string,
): { text: string; selection: TextSelectionRange } {
  if (
    !Number.isInteger(token.start) || !Number.isInteger(token.end) ||
    token.start < 0 || token.end < token.start || token.end > text.length ||
    (token.prefix !== '@' && token.prefix !== '#')
  ) throw new TypeError('The active composer token is invalid.');
  const normalized = value.trim().replace(/^[@#]/, '');
  if (!normalized || /\\s/.test(normalized)) throw new TypeError('A single token value is required.');
  const inserted = token.prefix + normalized + ' ';
  const nextText = text.slice(0, token.start) + inserted + text.slice(token.end);
  const caret = token.start + inserted.length;
  return { text: nextText, selection: { start: caret, end: caret } };
}
