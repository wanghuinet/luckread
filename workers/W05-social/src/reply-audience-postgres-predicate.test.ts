import { describe, expect, it } from 'vitest'
import {
  replyAudienceAllowedPostgresParams,
  replyAudienceAllowedPostgresSql,
} from './reply-audience-postgres-predicate.js'

describe('W05 PostgreSQL reply-audience predicate', () => {
  it('uses PostgreSQL JSON expansion and parameter placeholders only', () => {
    expect(replyAudienceAllowedPostgresSql).toContain('json_array_elements_text')
    expect(replyAudienceAllowedPostgresSql).not.toContain('json_each')
    expect(replyAudienceAllowedPostgresSql).not.toContain('?')
    expect(replyAudienceAllowedPostgresSql).toContain('::json')
    expect(replyAudienceAllowedPostgresSql).toContain('social_follow_relationships')
    expect(replyAudienceAllowedPostgresSql).toContain('social_user_interactions')
  })

  it('retains every D1 policy branch, mention override, and both blocked second-degree edges', () => {
    for (const audience of ["'everyone'", "'verified'", "'following'", "'mentioned'", "'followingNetwork'"]) {
      expect(replyAudienceAllowedPostgresSql).toContain(audience)
    }
    expect(replyAudienceAllowedPostgresSql).toContain('mentioned_override')
    expect(replyAudienceAllowedPostgresSql).toContain('owner_middle_block')
    expect(replyAudienceAllowedPostgresSql).toContain('middle_actor_block')
    expect(replyAudienceAllowedPostgresSql).toContain('second_degree')
    expect(replyAudienceAllowedPostgresSql).toContain('direct_follow')
  })

  it('binds the nine actor facts in the same semantic order as the D1 predicate', () => {
    const placeholders = [...new Set(
      [...replyAudienceAllowedPostgresSql.matchAll(/\$(\d+)/g)].map(match => Number(match[1])),
    )].sort((a, b) => a - b)
    expect(placeholders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(replyAudienceAllowedPostgresParams('viewer-1', true)).toEqual([
      'viewer-1', true, 'viewer-1', 'viewer-1', 'viewer-1',
      'viewer-1', 'viewer-1', 'viewer-1', 'viewer-1',
    ])
    expect(replyAudienceAllowedPostgresParams('viewer-1', false)[1]).toBe(false)
  })
})
