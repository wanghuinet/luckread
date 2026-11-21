import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateD103RemoteRunnerReview, D103_REVIEW_REF } from './remote-runner-review.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fail = (message) => { throw new Error('D1-03 partial remote release gate: ' + message) }

function readJson(base, path) {
  return JSON.parse(readFileSync(resolve(base, path), 'utf8'))
}

export function validateD103PartialReleaseState({ manifest, review } = {}) {
  const expectedIds = [
    'd1-03-w06-moderation-schema-v1',
    'd1-03-w09-platform-schema-v1',
    'd1-03-w10-async-execution-schema-v1',
  ]
  const expectedOmitted = [
    'Appeal','PlatformRuntime','ReconciliationOperation',
    'RecoveryOperation','Campaign','GrowthOperation',
  ].sort()
  const omitted = [...(review?.scope?.omittedEntities ?? [])].sort()
  return manifest?.domainId === 'D1-03' &&
    manifest?.databaseName === 'luckread_governance' &&
    manifest?.cloudflareD1DatabaseUuid === 'bda1d247-a371-4244-91ae-aef96034db7f' &&
    manifest?.postgresMajor === 18 &&
    manifest?.remoteApplyReady === false &&
    manifest?.businessDataImport === false &&
    manifest?.productionCutoverAuthorized === false &&
    manifest?.expected?.tables === 15 &&
    manifest?.expected?.explicitIndexes === 22 &&
    manifest?.expected?.triggers === 2 &&
    manifest?.expected?.triggerFunctions === 1 &&
    manifest?.expected?.foreignKeys === 2 &&
    manifest?.expected?.businessRows === 0 &&
    manifest?.expected?.controlSeedRows === 0 &&
    JSON.stringify(manifest?.entries?.map((entry) => entry.migrationId)) === JSON.stringify(expectedIds) &&
    review?.target?.domainId === 'D1-03' &&
    review?.target?.databaseName === 'luckread_governance' &&
    review?.target?.scope === 'schema-only' &&
    review?.scope?.kind === 'ADMITTED_MANIFEST_ENTRIES_ONLY' &&
    review?.scope?.migrationCount === 3 &&
    review?.scope?.tables === 15 &&
    review?.scope?.fullDomainSchemaComplete === false &&
    review?.scope?.omittedEntitiesRemainUnadmitted === true &&
    JSON.stringify(omitted) === JSON.stringify(expectedOmitted) &&
    review?.remoteApplyReady === false &&
    review?.businessDataImport === false &&
    review?.productionCutoverAuthorized === false
}

export function assertD103RemoteApplyReady({ repositoryRoot = root, currentHead } = {}) {
  const review = readJson(repositoryRoot, D103_REVIEW_REF)
  const manifest = readJson(repositoryRoot, 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json')
  if (!validateD103PartialReleaseState({ manifest, review })) {
    fail('D1-03 manifest/release record do not bind the exact three-entry partial schema scope')
  }
  const sourceReview = validateD103RemoteRunnerReview({
    root: repositoryRoot,
    review,
    currentHead,
  })
  if (!sourceReview.valid) {
    fail('source-pinned D1-03 release review is invalid: ' + sourceReview.errors.join('; '))
  }
  return {
    ready: true,
    partialRemoteApplyReady: true,
    remoteApplyReady: false,
    migrationCount: 3,
    fullDomainSchemaComplete: false,
    remoteNeonDdlExecuted: false,
  }
}

export function assertD103RemoteApplyBlocked({
  review = readJson(root, D103_REVIEW_REF),
  manifest = readJson(root, 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json'),
} = {}) {
  if (review?.status !== 'REMOTE_PARTIAL_SCHEMA_RELEASE_PENDING' ||
      review?.partialRemoteApplyReady !== false ||
      review?.remoteApplyReady !== false ||
      manifest?.domainId !== 'D1-03' ||
      manifest?.remoteApplyReady !== false ||
      review?.businessDataImport !== false ||
      review?.productionCutoverAuthorized !== false) {
    fail('D1-03 must remain blocked until the source-pinned partial remote release review is merged')
  }
  return { blocked: true, partialRemoteApplyReady: false, remoteNeonDdlExecuted: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === '--assert-ready') {
    const result = assertD103RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
    console.log('D1_03_PARTIAL_REMOTE_SCHEMA_RELEASED ' + JSON.stringify(result))
  } else if (mode === '--expect-blocked') {
    const result = assertD103RemoteApplyBlocked()
    console.log('D1_03_PARTIAL_REMOTE_SCHEMA_APPLY_BLOCKED_AS_EXPECTED ' + JSON.stringify(result))
  } else if (mode === '--validate-current-state') {
    const review = readJson(root, D103_REVIEW_REF)
    if (review?.status === 'REMOTE_PARTIAL_SCHEMA_RELEASE_PENDING' &&
        review?.partialRemoteApplyReady === false) {
      const result = assertD103RemoteApplyBlocked()
      console.log('D1_03_PARTIAL_REMOTE_SCHEMA_APPLY_BLOCKED_AS_EXPECTED ' + JSON.stringify(result))
    } else {
      const result = assertD103RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
      console.log('D1_03_PARTIAL_REMOTE_SCHEMA_RELEASE_VALID ' + JSON.stringify(result))
    }
  } else {
    fail('select an explicit gate mode: --assert-ready, --expect-blocked or --validate-current-state')
  }
}
