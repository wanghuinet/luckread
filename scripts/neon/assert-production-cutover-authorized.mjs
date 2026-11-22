import fs from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function assertProductionCutoverAuthorized({ bootstrap, evidence, domainIds }) {
  if (!Array.isArray(domainIds) || domainIds.length === 0) {
    throw new Error('At least one logical database domain is required')
  }
  if (evidence?.productionCutoverAuthorized !== true) {
    throw new Error('Global production cutover authorization is absent')
  }

  const results = []
  for (const domainId of domainIds) {
    const domain = bootstrap?.domains?.find((item) => item.domainId === domainId)
    const remote = evidence?.domains?.[domainId]
    if (!domain || !remote) {
      throw new Error(domainId + ': bootstrap or remote evidence record is missing')
    }
    if (domain.remoteSchemaApplied !== true && domain.partialRemoteSchemaApplied !== true) {
      throw new Error(domainId + ': remote Neon schema application is not verified')
    }
    if (domain.businessDataImported !== true || remote.businessDataImported !== true) {
      throw new Error(domainId + ': business data import is not verified')
    }
    if (domain.productionCutoverAuthorized !== true || remote.productionCutoverAuthorized !== true) {
      throw new Error(domainId + ': domain production cutover authorization is absent')
    }
    results.push({ domainId, databaseName: domain.databaseName, businessDataImported: true, productionCutoverAuthorized: true })
  }
  return results
}

function main() {
  const domainIds = process.argv.slice(2)
  const bootstrap = JSON.parse(fs.readFileSync('contracts/database/neon-five-domain-schema-bootstrap.v1.json', 'utf8'))
  const evidence = JSON.parse(fs.readFileSync('contracts/database/neon-five-database-remote-schema-evidence.v1.json', 'utf8'))
  const result = assertProductionCutoverAuthorized({ bootstrap, evidence, domainIds })
  process.stdout.write(JSON.stringify({ productionCutover: 'AUTHORIZED', domains: result }) + String.fromCharCode(10))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
