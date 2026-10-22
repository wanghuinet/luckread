export type IdentifiedSearchResult = { id: string }

/**
 * Append a page of search results while guaranteeing IDs are unique across
 * the existing list and within the incoming page itself.
 */
export function appendUniqueSearchResults<T extends IdentifiedSearchResult>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set<string>()
  const output: T[] = []

  for (const item of current) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    output.push(item)
  }

  for (const item of incoming) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    output.push(item)
  }

  return output
}
