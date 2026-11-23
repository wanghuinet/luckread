import fs from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { assertProductionCutoverAuthorized } from './assert-production-cutover-authorized.mjs'

function fixture() {
  return {
    bootstrap: {
      domains: [{
        domainId: 'D1-02',
        databaseName: 'luckreadpro',
        remoteSchemaApplied: true,
        businessDataImported: true,
        productionCutoverAuthorized: true,
      }],
    },
    evidence: {
      productionCutoverAuthorized: true,
      domains: {
        'D1-02': {
          businessDataImported: true,
          productionCutoverAuthorized: true,
        },
      },
    },
  }
}

test('admits only a domain with imported business data and explicit cutover authorization in both records', () => {
  const input = fixture()
  assert.deepEqual(
    assertProductionCutoverAuthorized({ ...input, domainIds: ['D1-02'] }),
    [{
      domainId: 'D1-02',
      databaseName: 'luckreadpro',
      businessDataImported: true,
      productionCutoverAuthorized: true,
    }],
  )
})

test('rejects schema-only initialization without business data import', () => {
  const input = fixture()
  input.bootstrap.domains[0].businessDataImported = false
  input.evidence.domains['D1-02'].businessDataImported = false
  assert.throws(
    () => assertProductionCutoverAuthorized({ ...input, domainIds: ['D1-02'] }),
    /business data import is not verified/,
  )
})

test('rejects missing explicit production cutover approval', () => {
  const input = fixture()
  input.bootstrap.domains[0].productionCutoverAuthorized = false
  input.evidence.domains['D1-02'].productionCutoverAuthorized = false
  assert.throws(
    () => assertProductionCutoverAuthorized({ ...input, domainIds: ['D1-02'] }),
    /domain production cutover authorization is absent/,
  )
})

test('rejects a domain when the global cutover record remains closed', () => {
  const input = fixture()
  input.evidence.productionCutoverAuthorized = false
  assert.throws(
    () => assertProductionCutoverAuthorized({ ...input, domainIds: ['D1-02'] }),
    /Global production cutover authorization is absent/,
  )
})

test('accepts the explicitly recorded partial schema state only after data import and cutover authorization', () => {
  const input = fixture()
  input.bootstrap.domains[0].remoteSchemaApplied = false
  input.bootstrap.domains[0].partialRemoteSchemaApplied = true
  assert.doesNotThrow(() => assertProductionCutoverAuthorized({ ...input, domainIds: ['D1-02'] }))
})

test('every Neon production deployment workflow enforces the matching domain cutover gate', () => {
  const workflows = new Map([
    ['.github/workflows/w01-payload-app-deploy.yml', 'D1-01'],
    ['.github/workflows/w02-deploy.yml', 'D1-01'],
    ['.github/workflows/w01-w02-binding-deploy.yml', 'D1-01'],
    ['.github/workflows/neon-runtime-cutover-w03.yml', 'D1-02'],
    ['.github/workflows/w03-content-runtime-deploy.yml', 'D1-02'],
    ['.github/workflows/neon-runtime-cutover-deploy.yml', 'D1-02 D1-03'],
    ['.github/workflows/w06-deploy.yml', 'D1-03'],
    ['.github/workflows/w07-subscription-runtime-deploy.yml', 'D1-04'],
    ['.github/workflows/neon-runtime-cutover-w07-d101.yml', 'D1-01 D1-04'],
  ])
  for (const [path, domains] of workflows) {
    const source = fs.readFileSync(path, 'utf8')
    assert.ok(
      source.includes('node scripts/neon/assert-production-cutover-authorized.mjs ' + domains),
      path + ' must gate deployment on ' + domains,
    )
  }
  const legacyW03 = fs.readFileSync('.github/workflows/w03-content-runtime-deploy.yml', 'utf8')
  assert.ok(legacyW03.includes("github.ref == 'refs/heads/main'"))
  assert.ok(legacyW03.includes("github.ref_protected == true"))
  assert.ok(legacyW03.includes('git merge-base --is-ancestor "$SOURCE_SHA" origin/main'))
})
