import type { Access, CollectionConfig } from 'payload'


const authenticated: Access = ({ req }) => Boolean(req.user?.id)

const ownsMedia: Access = async ({ req, id }) => {
  if (!req.user?.id || !id || !req.payload) return false
  try {
    const media = await req.payload.findByID({ collection: 'media', id, depth: 0 })
    return String((media as unknown as { ownerUserId?: string | number | null }).ownerUserId ?? '') === String(req.user.id)
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
      ({ data, req, operation, originalDoc }) => {
        if (operation === 'create' && req.user?.id) {
          data.ownerUserId = String(req.user.id)
        } else if (operation === 'update') {
          data.ownerUserId = (originalDoc as unknown as { ownerUserId?: string | number | null } | undefined)?.ownerUserId ?? null
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
