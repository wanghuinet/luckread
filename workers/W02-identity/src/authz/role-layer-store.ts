import {
  resolveGlobalLayer,
  type LayerResolution,
} from './role-assignment.js'

export interface RoleLayerStore {
  readAccountState(subjectId: string): Promise<string | null>
  resolveGlobalLayer(
    subjectId: string,
    accountState: string,
    now: string,
  ): Promise<LayerResolution>
}

/**
 * Resolves a subject's effective layer using W02-owned account state.
 * The caller supplies only the authenticated subject; account state and
 * evaluation time are always obtained from the authority boundary.
 */
export async function resolveLayerForSubject(
  store: RoleLayerStore,
  subjectId: string,
  now = new Date().toISOString(),
): Promise<LayerResolution> {
  if (
    typeof subjectId !== 'string' ||
    subjectId.length < 1 ||
    subjectId.length > 128 ||
    typeof now !== 'string' ||
    !Number.isFinite(Date.parse(now))
  ) {
    throw new TypeError('invalid W02 role-layer resolution input')
  }

  const accountState = await store.readAccountState(subjectId)
  if (typeof accountState !== 'string') return { decision: 'DENY' }

  return store.resolveGlobalLayer(subjectId, accountState, now)
}

/** Legacy D1 adapter is retained only for deprecated isolated unit-test fixtures. */
/**
 * @deprecated-next-version
 * Reason: Legacy Cloudflare D1 implementation retained only for isolated unit tests or the explicit schema/test fixture.
 * Replacement: PostgreSQL role-layer Store in src/neon/role-layer-postgres.ts.
 * Removal: Next release.
 * Condition: All W02 role-layer unit tests use PG/in-memory Store fixtures and no D1 account-state reads remain.
 */
export function createD1RoleLayerStore(db: D1Database): RoleLayerStore {
  return {
    async readAccountState(subjectId) {
      const row = await db.prepare(
        'SELECT account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
      ).bind(subjectId).first<{ accountState: string | null }>()
      return typeof row?.accountState === 'string' ? row.accountState : null
    },
    resolveGlobalLayer: (subjectId, accountState, now) =>
      resolveGlobalLayer(db, subjectId, accountState, now),
  }
}
