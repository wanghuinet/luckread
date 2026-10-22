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
    read: ({ req }) => {
      if (!req.user?.id) return false
      return { ownerUserId: { equals: String(req.user.id) } }
    },
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
    {
      name: 'uploadIdempotencyKey',
      type: 'text',
      unique: true,
      admin: { hidden: true, readOnly: true },
    },
    {
      name: 'uploadFingerprint',
      type: 'text',
      admin: { hidden: true, readOnly: true },
    },
  ],
  hooks: {
    beforeChange: [
      ({ data, req, operation, originalDoc }) => {
        if (operation === 'create' && req.user?.id) {
          data.ownerUserId = String(req.user.id)
          // Bind the unique upload key to this durable Media record. The public
          // v1 route checks for an earlier upload before consuming the body and
          // the unique index closes the concurrent-request race.
          data.uploadIdempotencyKey = req.headers.get('Idempotency-Key')?.trim() || null
          data.uploadFingerprint = req.headers.get('X-LuckRead-Upload-Fingerprint')?.trim() || null
        } else if (operation === 'update') {
          const original = originalDoc as unknown as {
            ownerUserId?: string | number | null
            uploadIdempotencyKey?: string | null
            uploadFingerprint?: string | null
          } | undefined
          data.ownerUserId = original?.ownerUserId ?? null
          data.uploadIdempotencyKey = original?.uploadIdempotencyKey ?? null
          data.uploadFingerprint = original?.uploadFingerprint ?? null
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
