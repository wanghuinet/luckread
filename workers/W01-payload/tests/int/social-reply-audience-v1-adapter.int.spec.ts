import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('reply audience backend closure', () => {
  it('routes owner policy reads and writes through authenticated W01 to W05 adapters', () => {
    const route = read('src/app/api/v1/contents/[contentId]/reply-audience/route.ts')
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain('/reply-audience')
    expect(route).toContain("method: 'GET'") 
    expect(route).toContain("method: 'PUT'") 
    expect(route).toContain('const mentionTargets = await resolveSocialMentionTargets(candidate.text)')
    expect(route).not.toContain("candidate.replyAudience === 'mentioned'")
    expect(route).toContain('mentionedUserIds: mentionTargets.map((target) => target.userId)')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_content_reply_policies')
  })

  it('forwards verified status only from W02 resolved role assignments', () => {
    const identityClient = read('src/content/w03-content-client.ts')
    const socialClient = read('src/social/w05-social-client.ts')
    expect(identityClient).toContain("assignment.roleId === 'verified_user'")
    expect(identityClient).toContain("X-LuckRead-Principal-Verified")
    expect(socialClient).toContain("X-LuckRead-Principal-Verified")
    expect(socialClient).toContain("input.principal.verified === true ? 'true' : 'false'")
  })

  it('persists the selected audience for drafts and before a post is published', () => {
    const composer = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const preflight = composer.split('async function runPreflight()')[1]?.split('\n\n  async function saveDraft()')[0] ?? ''
    expect(composer).toContain("useState<ReplyAudience>('everyone')")
    expect(composer).toContain("'/api/v1/contents/' + encodeURIComponent(contentId) + '/reply-audience'")
    expect(composer).toContain('await syncDraftReplyAudience(autoSavedDraft.id)')
    expect(composer).toContain('await syncDraftReplyAudience(savedDraft.id)')
    expect(preflight.indexOf('await syncDraftReplyAudience(savedDraft.id)')).toBeGreaterThan(
      preflight.indexOf('const savedDraft = await persistDraft()'),
    )
    expect(composer).toContain('recoveredReplyAudience = policy.data.data.replyAudience')
    expect(composer).toContain('setReplyAudience(recoveredReplyAudience)')
  })

  it('enforces every reply audience in W05 both before and inside the final comment insert', () => {
    const comments = read('../../workers/W05-social/src/comment-runtime.ts')
    const policy = read('../../workers/W05-social/src/reply-audience-runtime.ts')
    expect(comments).toContain('replyAudienceAllowedSql')
    expect(comments).toContain('AS reply_audience_allowed')
    expect(comments).toContain("throw new CommentRuntimeError('PERMISSION_DENIED', 403)")
    expect(comments).toContain('AND ${replyAudienceAllowedSql}')
    expect(policy).toContain('social_follow_relationships')
    expect(policy).toContain('json_each')
    expect(policy).toContain('second_degree')
    expect(policy).toContain('actorVerified: boolean')
    expect(policy).toContain('replyAudienceAllowedParams')
  })

  it('stores reply policies outside canonical W03 content and defaults legacy posts to everyone', () => {
    const migration = read('../../workers/W05-social/migrations/20261019_015_social_reply_audience_v1.sql')
    const policy = read('../../workers/W05-social/src/reply-audience-runtime.ts')
    expect(migration).toContain('social_content_reply_policies')
    expect(migration).toContain("CHECK (audience IN ('everyone','verified','following','mentioned','followingNetwork'))")
    expect(policy).toContain("COALESCE(policy.audience, 'everyone')")
    expect(policy).not.toContain('UPDATE contents')
    expect(policy).not.toContain('INSERT INTO contents')
  })
})
