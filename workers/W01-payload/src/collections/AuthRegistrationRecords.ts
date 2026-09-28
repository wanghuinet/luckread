import type { CollectionConfig } from 'payload'

const internalAccess = {
  create: () => false,
  read: () => false,
  update: () => false,
  delete: () => false,
}

const textIdField = {
  name: 'id',
  type: 'text' as const,
  required: true,
  unique: true,
  index: true,
  admin: { hidden: true },
}

export const AuthRegistrationEnvelopes: CollectionConfig = {
  slug: 'auth-registration-envelopes',
  dbName: 'auth_registration_envelopes',
  admin: { hidden: true },
  endpoints: false,
  graphQL: false,
  disableDuplicate: true,
  access: internalAccess,
  fields: [
    textIdField,
    { name: 'idempotencyKey', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'activeKey', type: 'text', unique: true, index: true, admin: { hidden: true } },
    { name: 'scope', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'endpoint', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'payloadHash', type: 'text', required: true, index: true, admin: { hidden: true } },
    {
      name: 'state',
      type: 'select',
      required: true,
      options: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
      index: true,
      admin: { hidden: true },
    },
    { name: 'responseDigest', type: 'text', admin: { hidden: true } },
    { name: 'committedResponse', type: 'json', required: true, admin: { hidden: true } },
    { name: 'expiresAt', type: 'date', required: true, index: true, admin: { hidden: true } },
    { name: 'consentRecordId', type: 'text', required: true, index: true, admin: { hidden: true } },
  ],
  timestamps: true,
}

export const Consents: CollectionConfig = {
  slug: 'consents',
  dbName: 'consents',
  admin: { hidden: true },
  endpoints: false,
  graphQL: false,
  disableDuplicate: true,
  access: internalAccess,
  fields: [
    textIdField,
    { name: 'actorSubjectId', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'ownerSubjectId', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'resourceId', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'resourceType', type: 'text', required: true, index: true, admin: { hidden: true } },
    {
      name: 'purpose',
      type: 'select',
      required: true,
      options: ['ACCOUNT_REGISTRATION'],
      index: true,
      admin: { hidden: true },
    },
    {
      name: 'state',
      type: 'select',
      required: true,
      options: ['GRANTED', 'REVOKED', 'RESTRICTED_PROCESSING'],
      index: true,
      admin: { hidden: true },
    },
    { name: 'policyVersion', type: 'text', required: true, index: true, admin: { hidden: true } },
    {
      name: 'legalBasis',
      type: 'select',
      required: true,
      options: ['CONSENT'],
      index: true,
      admin: { hidden: true },
    },
    { name: 'withdrawnAt', type: 'date', index: true, admin: { hidden: true } },
    {
      name: 'retentionClass',
      type: 'select',
      required: true,
      options: ['LEGAL_AUDIT'],
      index: true,
      admin: { hidden: true },
    },
    { name: 'retentionUntil', type: 'date', required: true, index: true, admin: { hidden: true } },
    { name: 'sourceAuthority', type: 'text', required: true, index: true, admin: { hidden: true } },
    { name: 'legalHoldRef', type: 'text', index: true, admin: { hidden: true } },
  ],
  timestamps: true,
}