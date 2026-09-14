import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '../../../../../payload.config'
import { publishScheduledContent } from '../../../../../lib/content-scheduler'

export const dynamic = 'force-dynamic'

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export async function POST(request: Request) {
  const expected = process.env.CRON_INTERNAL_TOKEN
  if (!expected) {
    return NextResponse.json({ error: 'scheduler_not_configured' }, { status: 503 })
  }

  const authorization = request.headers.get('authorization') ?? ''
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!constantTimeEqual(provided, expected)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const scheduledTime = Number(request.headers.get('x-cron-scheduled-time'))
  const now = Number.isFinite(scheduledTime) && scheduledTime > 0 ? new Date(scheduledTime) : new Date()

  const payload = await getPayload({ config })
  const result = await publishScheduledContent({ payload, now, limit: 50 })

  return NextResponse.json({ ok: true, ...result, scheduledTime: now.toISOString() })
}
