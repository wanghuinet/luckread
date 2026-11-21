import type { Pool } from 'pg'

import type { RoleLayerStore } from '../authz/role-layer-store.js'
import { resolveGlobalLayerPostgres } from './role-assignment-postgres.js'

/** PostgreSQL counterpart of the W02 internal role-layer authority store. */
export function createPostgresRoleLayerStore(pool: Pool): RoleLayerStore {
  return {
    async readAccountState(subjectId) {
      const result = await pool.query<{ accountState: string | null }>(
        'SELECT account_state AS "accountState" FROM "user" WHERE id = $1 LIMIT 1',
        [subjectId],
      )
      const state = result.rows[0]?.accountState
      return typeof state === 'string' ? state : null
    },
    resolveGlobalLayer: (subjectId, accountState, now) =>
      resolveGlobalLayerPostgres(pool, subjectId, accountState, now),
  }
}
