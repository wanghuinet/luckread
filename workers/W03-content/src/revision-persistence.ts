import type { ContentD1, ContentRecord } from './content-runtime.js'

export function revisionInsertStatement(
  db: ContentD1,
  input: {
    revisionId: string
    contentId: string
    revisionNumber: number
    contentVersion: number
    title: string
    bodyRef: string
    mediaRefs: string[]
    coverRef: string | null
    state: ContentRecord['state']
    actorUserId: string
    sourceRevisionId?: string | null
    reason?: string | null
    correlationId: string
    createdAt: string
  },
) {
  return db.prepare(
    `INSERT INTO content_revisions
      (revision_id, content_id, revision_number, content_version, title, body_ref, media_refs_json, cover_ref,
       state, actor_user_id, source_revision_id, reason, correlation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.revisionId,
    input.contentId,
    input.revisionNumber,
    input.contentVersion,
    input.title,
    input.bodyRef,
    JSON.stringify(input.mediaRefs),
    input.coverRef,
    input.state,
    input.actorUserId,
    input.sourceRevisionId ?? null,
    input.reason ?? null,
    input.correlationId,
    input.createdAt,
  )
}
