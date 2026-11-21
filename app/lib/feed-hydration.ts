import type { ApiContentRecord } from './content-adapter';

/**
 * Select only feed records whose cards have entered the visible list window.
 * Feed pages are larger than the viewport; delaying hydration for unseen cards
 * avoids a burst of per-post W05 social and body/profile reads on first paint.
 */
export function selectVisibleFeedHydrationRecords(
  records: readonly ApiContentRecord[],
  visibleContentIds: readonly string[],
  alreadyHydratedIds: ReadonlySet<string>,
): ApiContentRecord[] {
  const visible = new Set(visibleContentIds.map((id) => id.trim()).filter(Boolean));
  const selected = new Set<string>();

  return records.filter((item) => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!id || !visible.has(id) || alreadyHydratedIds.has(id) || selected.has(id)) {
      return false;
    }
    selected.add(id);
    return true;
  });
}
