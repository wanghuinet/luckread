export type ComposerAssetMoveDirection = -1 | 1;

/** Return a reordered copy without mutating the composer state array. */
export function moveComposerAsset<T>(
  items: readonly T[],
  fromIndex: number,
  direction: ComposerAssetMoveDirection,
): T[] {
  const toIndex = fromIndex + direction;
  if (
    !Number.isInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length
  ) {
    return [...items];
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
