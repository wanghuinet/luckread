import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-02-migration-manifest.v1.json'), 'utf8'))

export function validateD1_02ReleaseContract(value = manifest) {
  return value?.domainId === 'D1-02' &&
    value?.databaseName === 'luckreadpro' &&
    value?.databaseUuid === '6c342634-97f6-4248-9f4a-85772af4f22c' &&
    value?.postgresMajor === 18 &&
    value?.businessDataImport === false &&
    value?.productionCutoverAuthorized === false &&
    typeof value?.remoteApplyReady === 'boolean'
}

if (!validateD1_02ReleaseContract()) {
  throw new Error('D1-02 remote release contract is malformed or does not pin the exact schema-only target')
}

if (process.argv[2] === '--assert-ready') {
  if (manifest.remoteApplyReady !== true) {
    throw new Error('D1-02 remote Neon schema apply is not released; remoteApplyReady remains false')
  }
  console.log('D1_02_REMOTE_SCHEMA_APPLY_RELEASED')
} else if (process.argv[2] === '--assert-configured') {
  console.log('D1_02_REMOTE_SCHEMA_APPLY_GATE_CONFIGURED ' + JSON.stringify({ remoteApplyReady: manifest.remoteApplyReady }))
} else {
  throw new Error('Select --assert-configured or --assert-ready')
}
