import { headers as getHeaders } from 'next/headers.js'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  return (
    <div>
      <h1>{!user || !('email' in user) ? 'Welcome to Luckread.' : `Welcome back, ${user.email}`}</h1>
      <p>Payload Cloudflare baseline is running.</p>
      <a href={payloadConfig.routes.admin}>Go to admin panel</a>
    </div>
  )
}
