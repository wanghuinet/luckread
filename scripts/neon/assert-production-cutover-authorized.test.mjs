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
