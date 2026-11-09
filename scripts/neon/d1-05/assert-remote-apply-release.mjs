import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateD105RemoteRunnerReview,
  D105_REVIEW_REF,
} from './remote-runner-review.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fail = (message) => { throw new Error('D1-05 schema-only release gate: ' + message) }

function readJson(base, path) {
  return JSON.parse(readFileSync(resolve(base, path), 'utf8'))
}

export function validateD105SchemaOnlyReleaseState({ manifest, review } = {}) {
  const expectedMigrationIds = ['d1-05-w11-analytics-schema-v1']
  const expectedBlockers = [
    'Retention policy for event and aggregate classes is not admitted.',
    'Deletion/privacy-request behavior for actor-linked and creator-linked analytics projections is not admitted.',
    'Consent, lawful purpose and collection eligibility rules are not admitted.',
  ]
  const blockers = review?.runtimeAdmissionBlockers ?? []
  return manifest?.domainId === 'D1-05' &&
    manifest?.databaseName === 'allluck' &&
    manifest?.cloudflareD1DatabaseUuid === '77d82be2-d12e-4a17-b410-9aa7d376bc11' &&
    manifest?.postgresMajor === 18 &&
    manifest?.remoteApplyReady === false &&
    manifest?.businessDataImport === false &&
    manifest?.productionCutoverAuthorized === false &&
    manifest?.expected?.tables === 6 &&
    manifest?.expected?.explicitIndexes === 8 &&
    manifest?.expected?.triggers === 0 &&
    manifest?.expected?.triggerFunctions === 0 &&
    manifest?.expected?.foreignKeys === 0 &&
    manifest?.expected?.businessRows === 0 &&
    manifest?.expected?.controlSeedRows === 0 &&
    JSON.stringify(manifest?.entries?.map((entry) => entry.migrationId)) === JSON.stringify(expectedMigrationIds) &&
    review?.target?.domainId === 'D1-05' &&
    review?.target?.databaseName === 'allluck' &&
    review?.target?.cloudflareD1DatabaseUuid === '77d82be2-d12e-4a17-b410-9aa7d376bc11' &&
    review?.target?.postgresMajor === 18 &&
    review?.target?.scope === 'EMPTY_SCHEMA_ONLY' &&
    review?.scope?.kind === 'ALL_ADMITTED_W11_D1_05_ANALYTICS_SCHEMA_ONLY' &&
    review?.scope?.migrationCount === 1 &&
    review?.scope?.tables === 6 &&
    review?.scope?.explicitIndexes === 8 &&
    review?.scope?.businessRows === 0 &&
    review?.scope?.controlSeedRows === 0 &&
    review?.scope?.runtimeDataIngestionEnabled === false &&
    review?.scope?.runtimeBindingChangeAllowed === false &&
    review?.schemaOnlyRemoteApplyReady === true &&
    review?.remoteApplyReady === false &&
    review?.businessDataImport === false &&
    review?.productionCutoverAuthorized === false &&
    expectedBlockers.every((item) => blockers.includes(item))
}

export function assertD105RemoteApplyReady({ repositoryRoot = root, currentHead } = {}) {
  const review = readJson(repositoryRoot, D105_REVIEW_REF)
  const manifest = readJson(repositoryRoot, 'contracts/database/neon-d1-05-shared-migration-manifest.v1.json')
  if (!validateD105SchemaOnlyReleaseState({ manifest, review })) {
    fail('D1-05 release record does not bind the exact six-table empty-schema-only scope')
  }
  const sourceReview = validateD105RemoteRunnerReview({
    root: repositoryRoot,
    review,
    currentHead,
  })
  if (!sourceReview.valid) {
    fail('source-pinned D1-05 release review is invalid: ' + sourceReview.errors.join('; '))
  }
  return {
    ready: true,
    schemaOnlyRemoteApplyReady: true,
    remoteApplyReady: false,
    migrationCount: 1,
    tables: 6,
    runtimeDataIngestionEnabled: false,
    remoteNeonDdlExecuted: false,
  }
}

export function assertD105RemoteApplyBlocked({
  review = readJson(root, D105_REVIEW_REF),
  manifest = readJson(root, 'contracts/database/neon-d1-05-shared-migration-manifest.v1.json'),
} = {}) {
  if (review?.status !== 'REMOTE_SCHEMA_ONLY_PROVISIONING_PENDING_REVIEW' ||
      review?.schemaOnlyRemoteApplyReady !== false ||
      review?.remoteApplyReady !== false ||
      manifest?.domainId !== 'D1-05' ||
      manifest?.remoteApplyReady !== false ||
      review?.businessDataImport !== false ||
      review?.productionCutoverAuthorized !== false) {
    fail('D1-05 must remain blocked until the source-pinned schema-only release review is merged')
  }
  return {
    blocked: true,
    schemaOnlyRemoteApplyReady: false,
    runtimeDataIngestionEnabled: false,
    remoteNeonDdlExecuted: false,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === '--assert-ready') {
    const result = assertD105RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
    console.log('D1_05_SCHEMA_ONLY_REMOTE_RELEASED ' + JSON.stringify(result))
  } else if (mode === '--expect-blocked') {
    const result = assertD105RemoteApplyBlocked()
    console.log('D1_05_SCHEMA_ONLY_REMOTE_APPLY_BLOCKED_AS_EXPECTED ' + JSON.stringify(result))
  } else if (mode === '--validate-current-state') {
    const review = readJson(root, D105_REVIEW_REF)
    if (review?.status === 'REMOTE_SCHEMA_ONLY_PROVISIONING_PENDING_REVIEW' &&
        review?.schemaOnlyRemoteApplyReady === false) {
      const result = assertD105RemoteApplyBlocked()
      console.log('D1_05_SCHEMA_ONLY_REMOTE_APPLY_BLOCKED_AS_EXPECTED ' + JSON.stringify(result))
    } else {
      const result = assertD105RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
      console.log('D1_05_SCHEMA_ONLY_REMOTE_RELEASE_VALID ' + JSON.stringify(result))
    }
  } else {
    fail('select an explicit gate mode: --assert-ready, --expect-blocked or --validate-current-state')
  }
}
