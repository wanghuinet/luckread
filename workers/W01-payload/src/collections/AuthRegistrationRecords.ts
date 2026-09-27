import type { CollectionConfig } from 'payload'

const internalAccess = {
  create: () => false,
  read: () => false,
  update: () => false,
  delete: () => false,
}

export const AuthRegistrationEnvelopes: CollectionConfig = {
  slug: 'auth-registration-envelopes',
  admin: {
    hidden: true,
  },
  access: internalAccess,
  fields: [
    {
      name: 'idempotencyKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'scope',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'endpoint',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'payloadHash',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'state',
      type: 'select',
      required: true,
      options: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
      index: true,
    },
    {
      name: 'responseDigest',
      type: 'text',
    },
    {
      name: 'committedResponse',
      type: 'textarea',
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'consentRecordId',
      type: 'text',
      index: true,
    },
  ],
}

export const Consents: CollectionConfig = {
  slug: 'consents',
  admin: {
    hidden: true,
  },
  access: internalAccess,
  fields: [
    {
      name: 'actorSubjectId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'ownerSubjectId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'resourceId',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'resourceType',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'purpose',
      type: 'select',
      required: true,
      options: ['ACCOUNT_REGISTRATION'],
      index: true,
    },
    {
      name: 'state',
      type: 'select',
      required: true,
      options: ['GRANTED', 'REVOKED', 'RESTRICTED_PROCESSING'],
      index: true,
    },
    {
      name: 'policyVersion',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'legalBasis',
      type: 'select',
      required: true,
      options: ['CONSENT'],
      index: true,
    },
    {
      name: 'withdrawnAt',
      type: 'date',
      index: true,
    },
    {
      name: 'retentionClass',
      type: 'select',
      required: true,
      options: ['LEGAL_AUDIT'],
      index: true,
    },
    {
      name: 'retentionUntil',
      type: 'date',
      required: true,
      index: true,
    },
    {
      name: 'sourceAuthority',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'legalHoldRef',
      type: 'text',
      index: true,
    },
  ],
}
