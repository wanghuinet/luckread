/// <reference types="@cloudflare/workers-types" />

export class FollowRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

type FollowRow = { relationship_id: string; follower_user_id: string; target_user_id: string; created_at: string }
const userId = (v: string) => { const id=v.trim(); if (!id || id.length>256) throw new FollowRuntimeError('VALIDATION_FAILED',400); return id }

export async function follow(db: D1Database, followerUserId: string, targetUserId: string): Promise<FollowRow> {
  const follower=userId(followerUserId), target=userId(targetUserId)
  if (follower===target) throw new FollowRuntimeError('SELF_FOLLOW_NOT_ALLOWED',409)
  const existing=await db.prepare('SELECT relationship_id, follower_user_id, target_user_id, created_at FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1').bind(follower,target).first<FollowRow>()
  if (existing) return existing
  const relationshipId=crypto.randomUUID(), createdAt=new Date().toISOString()
  try { await db.prepare('INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES (?, ?, ?, ?)').bind(relationshipId,follower,target,createdAt).run() }
  catch (e) { if (!(e instanceof Error) || !e.message.toLowerCase().includes('unique')) throw e }
  const row=await db.prepare('SELECT relationship_id, follower_user_id, target_user_id, created_at FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1').bind(follower,target).first<FollowRow>()
  if (!row) throw new FollowRuntimeError('FOLLOW_WRITE_FAILED',500)
  return row
}

export async function unfollow(db: D1Database, followerUserId: string, targetUserId: string): Promise<void> {
  const follower=userId(followerUserId), target=userId(targetUserId)
  if (follower===target) throw new FollowRuntimeError('SELF_FOLLOW_NOT_ALLOWED',409)
  await db.prepare('DELETE FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ?').bind(follower,target).run()
}

export async function getFollowStatus(db: D1Database, followerUserId: string, targetUserId: string) {
  const follower=userId(followerUserId), target=userId(targetUserId)
  const row=await db.prepare('SELECT relationship_id, created_at FROM social_follow_relationships WHERE follower_user_id = ? AND target_user_id = ? LIMIT 1').bind(follower,target).first<{relationship_id:string;created_at:string}>()
  return { following:Boolean(row), relationshipId:row?.relationship_id ?? null, createdAt:row?.created_at ?? null }
}