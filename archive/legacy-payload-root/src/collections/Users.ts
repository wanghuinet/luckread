import type { CollectionConfig } from 'payload'

import { ownUserOnly } from '../authz/authorization'
import { assertClientWritableFields } from '../authz/field-policy'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  access: {
    read: ownUserOnly,
    update: ownUserOnly,
    delete: () => false,
  },
  admin: {
    useAsTitle: 'username',
  },
  fields: [
    {
      name: 'username',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'displayName',
      type: 'text',
    },
    {
      name: 'bio',
      type: 'textarea',
    },
    {
      name: 'avatar',
      type: 'text',
    },
    {
      name: 'locale',
      type: 'text',
      defaultValue: 'en-US',
    },
    {
      name: 'timezone',
      type: 'text',
      defaultValue: 'UTC',
    },
  ],
  hooks: {
    beforeChange: [
      ({ data }) => {
        assertClientWritableFields(data)
        return data
      },
    ],
  },
}
