import { describe, expect, it } from 'vitest'
import { appendUniqueSearchResults } from '../../src/app/(twitter-clone)/search/search-results.js'

describe('appendUniqueSearchResults', () => {
  it('deduplicates IDs across the current list and within the incoming page', () => {
    const current = [
      { id: 'content-a', title: 'A' },
      { id: 'content-b', title: 'B' },
      { id: 'content-b', title: 'duplicate already present' },
    ]
    const incoming = [
      { id: 'content-b', title: 'duplicate from next page' },
      { id: 'content-c', title: 'C' },
      { id: 'content-c', title: 'duplicate in next page' },
      { id: 'content-a', title: 'already shown on page one' },
    ]

    expect(appendUniqueSearchResults(current, incoming)).toEqual([
      { id: 'content-a', title: 'A' },
      { id: 'content-b', title: 'B' },
      { id: 'content-c', title: 'C' },
    ])
  })

  it('preserves incoming order for new IDs', () => {
    expect(
      appendUniqueSearchResults([{ id: 'existing' }], [
        { id: 'later' },
        { id: 'earlier' },
      ]),
    ).toEqual([{ id: 'existing' }, { id: 'later' }, { id: 'earlier' }])
  })
})
