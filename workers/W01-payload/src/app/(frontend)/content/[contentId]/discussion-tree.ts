export type DiscussionCommentRef = {
  id: string
  parentId: string | null
  depth: number
}

export type DiscussionTreeNode<T extends DiscussionCommentRef> = {
  comment: T
  children: DiscussionTreeNode<T>[]
  level: number
  orphan: boolean
}

/**
 * Group the already-authorized, cursor-paginated W05 comment response into a
 * presentation tree. This helper never fetches data or changes comment state.
 *
 * Missing parents can happen at a pagination boundary; these comments remain
 * visible as root-level items. Invalid self/cyclic parent references are
 * detached so malformed payloads can never make a branch disappear.
 */
export function buildDiscussionTree<T extends DiscussionCommentRef>(
  comments: readonly T[],
): DiscussionTreeNode<T>[] {
  const byId = new Map<string, T>()
  for (const comment of comments) {
    if (!byId.has(comment.id)) byId.set(comment.id, comment)
  }

  const parentById = new Map<string, string | null>()
  const orphanById = new Map<string, boolean>()
  for (const comment of byId.values()) {
    const parentExists = !!comment.parentId && byId.has(comment.parentId)
    parentById.set(
      comment.id,
      parentExists && comment.parentId !== comment.id ? comment.parentId : null,
    )
    orphanById.set(comment.id, !!comment.parentId && !parentExists)
  }

  // Detect malformed cycles before materializing the tree. Detach the node
  // whose walk detects the cycle; all comments stay visible and reachable.
  for (const id of byId.keys()) {
    let current: string | null = id
    const seen = new Set<string>()
    while (current) {
      if (seen.has(current)) {
        parentById.set(id, null)
        break
      }
      seen.add(current)
      current = parentById.get(current) ?? null
    }
  }

  const nodes = new Map<string, DiscussionTreeNode<T>>()
  for (const comment of byId.values()) {
    nodes.set(comment.id, {
      comment,
      children: [],
      level: 0,
      orphan: orphanById.get(comment.id) === true,
    })
  }

  const roots: DiscussionTreeNode<T>[] = []
  // Iterate in API order so root and sibling order stays chronological.
  for (const comment of byId.values()) {
    const node = nodes.get(comment.id)!
    const parentId = parentById.get(comment.id)
    const parent = parentId ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const assignLevels = (siblings: DiscussionTreeNode<T>[], level: number): void => {
    for (const node of siblings) {
      node.level = level
      assignLevels(node.children, level + 1)
    }
  }
  assignLevels(roots, 0)
  return roots
}
