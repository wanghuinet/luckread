import { describe, expect, it } from 'vitest'

import { buildDiscussionTree } from '../../src/app/(frontend)/content/[contentId]/discussion-tree'

type Comment = {
  id: string
  parentId: string | null
  depth: number
  body: string
}

const comment = (id: string, parentId: string | null = null, depth = 0): Comment => ({
  id,
  parentId,
  depth,
  body: id,
})

describe('buildDiscussionTree', () => {
  it('nests replies beneath their parent while preserving root and sibling order', () => {
    const tree = buildDiscussionTree([
      comment('root-a'),
      comment('reply-a-1', 'root-a', 1),
      comment('root-b'),
      comment('reply-a-2', 'root-a', 1),
      comment('reply-a-1-child', 'reply-a-1', 2),
    ])

    expect(tree.map((node) => node.comment.id)).toEqual(['root-a', 'root-b'])
    expect(tree[0].children.map((node) => node.comment.id)).toEqual(['reply-a-1', 'reply-a-2'])
    expect(tree[0].children[0].children.map((node) => node.comment.id)).toEqual(['reply-a-1-child'])
    expect(tree[0].children[0].level).toBe(1)
    expect(tree[0].children[0].children[0].level).toBe(2)
  })

  it('keeps comments visible when their parent falls outside the loaded cursor pages', () => {
    const tree = buildDiscussionTree([
      comment('root-a'),
      comment('reply-a', 'root-a', 1),
      comment('orphan-reply', 'parent-from-an-earlier-page', 2),
    ])

    expect(tree.map((node) => node.comment.id)).toEqual(['root-a', 'orphan-reply'])
    expect(tree[1].orphan).toBe(true)
    expect(tree[1].children).toEqual([])
  })

  it('detaches invalid cycles rather than losing all comments', () => {
    const tree = buildDiscussionTree([
      comment('a', 'b', 1),
      comment('b', 'a', 1),
      comment('c', 'a', 1),
    ])

    const visit = (nodes: typeof tree): string[] => nodes.flatMap((node) => [
      node.comment.id,
      ...visit(node.children as typeof tree),
    ])

    expect(visit(tree).sort()).toEqual(['a', 'b', 'c'])
  })

  it('treats duplicate IDs deterministically and keeps one logical item', () => {
    const tree = buildDiscussionTree([
      comment('same'),
      { ...comment('same'), body: 'duplicate' },
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].comment.body).toBe('same')
  })
})
