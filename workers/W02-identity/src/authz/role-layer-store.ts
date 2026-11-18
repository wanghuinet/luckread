import type { LayerResolution } from './role-assignment.js'

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
