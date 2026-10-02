import { describe, expect, it, vi } from 'vitest'
import { follow, getFollowStatus, unfollow } from './follow-runtime.js'

const db=(firstResults: unknown[]=[])=>{ let i=0; const prepare=vi.fn((sql:string)=>({bind:vi.fn((...args:unknown[])=>({first:vi.fn(async()=>firstResults[i++]??null),run:vi.fn(async()=>({sql,args}))}))})); return {prepare} as unknown as D1Database }

describe('follow runtime',()=>{
 it('creates a relationship',async()=>{ const row={relationship_id:'r1',follower_user_id:'u1',target_user_id:'u2',created_at:'2026-10-02T00:00:00.000Z'}; await expect(follow(db([null,row]),'u1','u2')).resolves.toEqual(row) })
 it('is idempotent',async()=>{ const row={relationship_id:'r1',follower_user_id:'u1',target_user_id:'u2',created_at:'2026-10-02T00:00:00.000Z'}; const d=db([row]); await expect(follow(d,'u1','u2')).resolves.toEqual(row); expect(d.prepare).toHaveBeenCalledTimes(1) })
 it('rejects self follow',async()=>{ await expect(follow(db(),'u1','u1')).rejects.toMatchObject({code:'SELF_FOLLOW_NOT_ALLOWED',status:409}) })
 it('unfollows',async()=>{ await expect(unfollow(db(),'u1','u2')).resolves.toBeUndefined() })
 it('reads status',async()=>{ await expect(getFollowStatus(db([{relationship_id:'r1',created_at:'2026-10-02T00:00:00.000Z'}]),'u1','u2')).resolves.toEqual({following:true,relationshipId:'r1',createdAt:'2026-10-02T00:00:00.000Z'}) })
 it('rejects invalid ids',async()=>{ await expect(follow(db(),'','u2')).rejects.toMatchObject({code:'VALIDATION_FAILED',status:400}) })
})