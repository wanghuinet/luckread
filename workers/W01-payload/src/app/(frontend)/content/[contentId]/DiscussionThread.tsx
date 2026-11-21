import { useMemo, type ReactNode } from 'react'

import { buildDiscussionTree, type DiscussionCommentRef, type DiscussionTreeNode } from './discussion-tree'

type Props<T extends DiscussionCommentRef> = {
  comments: readonly T[]
  renderComment: (comment: T) => ReactNode
}

export default function DiscussionThread<T extends DiscussionCommentRef>({
  comments,
  renderComment,
}: Props<T>) {
  const roots = useMemo(() => buildDiscussionTree(comments), [comments])

  return (
    <div className="content-comment-list" role="list" aria-label="Comment discussion thread">
      {roots.map((node) => (
        <ThreadNode key={node.comment.id} node={node} renderComment={renderComment} />
      ))}
    </div>
  )
}

function ThreadNode<T extends DiscussionCommentRef>({
  node,
  renderComment,
}: {
  node: DiscussionTreeNode<T>
  renderComment: (comment: T) => ReactNode
}) {
  return (
    <div
      data-thread-depth={node.level}
      data-orphan-reply={node.orphan ? 'true' : undefined}
      role="listitem"
    >
      {renderComment(node.comment)}
      {node.children.length > 0 ? (
        <div className="content-comment-list" role="list" aria-label="Replies">
          {node.children.map((child) => (
            <ThreadNode key={child.comment.id} node={child} renderComment={renderComment} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
