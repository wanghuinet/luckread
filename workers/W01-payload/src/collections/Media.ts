import type { CollectionConfig } from 'payload'

const authenticated = ({ req }: { req: { user?: { id?: string | number } | null } }) =>
  Boolean(req.user?.id)

const ownsMedia = async ({
  req,
  id,
}: {
  req: {
    user?: { id?: string | number } | null
    payload?: {
      findByID: (args: {
        collection: string
        id: string | number
        depth?: number
      }) => Promise<{ ownerUserId?: string | number | null }>
    }
  }
  id?: string | number
}) => {
  if (!req.user?.id || !id || !req.payload) return false
  try {
    const media = await req.payload.findByID({ collection: 'media', id, depth: 0 })
    return String(media.ownerUserId ?? '') === String(req.user.id)
  } catch {
    return false
  }
}

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
    create: authenticated,
    update: ownsMedia,
    delete: ownsMedia,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'ownerUserId',
      type: 'text',
      admin: {
        readOnly: true,
      },
    },
  ],
  hooks: {
    beforeChange: [
      ({ data, req, operation }) => {
        if (operation === 'create' && req.user?.id) {
          data.ownerUserId = String(req.user.id)
        }
        return data
      },
    ],
  },
  upload: {
    crop: false,
    focalPoint: false,
  },
}
