import type { ReactNode } from 'react'

import { buildDiscussionTree, type DiscussionCommentRef, type DiscussionTreeNode } from './discussion-tree'
import styles from './discussion-thread.module.css'

type Props<T extends DiscussionCommentRef> = {
  comments: readonly T[]
  renderComment: (comment: T) => ReactNode
}

export default function DiscussionThread<T extends DiscussionCommentRef>({
  comments,
  renderComment,
}: Props<T>) {
  const roots = buildDiscussionTree(comments)

  return (
    <div className={styles.thread} role="list" aria-label="Comment discussion thread">
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
      className={node.level > 0 ? styles.nestedNode : styles.node}
      data-thread-depth={node.level}
      data-orphan-reply={node.orphan ? 'true' : undefined}
      role="listitem"
    >
      <div className={styles.commentContent}>{renderComment(node.comment)}</div>
      {node.children.length > 0 ? (
        <div className={styles.children} role="group" aria-label="Replies">
          {node.children.map((child) => (
            <ThreadNode key={child.comment.id} node={child} renderComment={renderComment} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
