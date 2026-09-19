import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  fields: [
    {
      name: 'username',
      type: 'text',
      required: true,
      unique: true,
      index: true,
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
  versions: false,
}
