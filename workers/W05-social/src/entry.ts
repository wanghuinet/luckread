import { createW05SocialWorker } from './index.js'
import {
  getW05MessagingOutboxDatabase,
  getW05PushEndpointPostgresDatabase,
  getW05SocialWorkerDependencies,
} from './neon/runtime.js'
import { NotificationPushWorkflow } from './notification-push-workflow.js'
import { MessagingRealtimeHub } from './messaging-realtime-hub.js'
import { dispatchMessagingOutboxBatch, pruneDeliveredMessagingOutbox } from './messaging-outbox.js'

// Keep Cloudflare's virtual Workflow runtime module in the deploy entry only.
export { NotificationPushWorkflow, MessagingRealtimeHub }

type W05Worker = ReturnType<typeof createW05SocialWorker>
type W05Env = Parameters<W05Worker['fetch']>[1]
type W05Context = Parameters<W05Worker['fetch']>[2]

const workers = new WeakMap<object, W05Worker>()

function getWorker(env: W05Env): W05Worker {
  const key = env as object
  const cached = workers.get(key)
  if (cached) return cached

  const worker = createW05SocialWorker({
    ...getW05SocialWorkerDependencies(env),
    pushEndpointDatabase: getW05PushEndpointPostgresDatabase(env),
  })
  workers.set(key, worker)
  return worker
}

export default {
  fetch(request: Request, env: W05Env, ctx: W05Context): Promise<Response> {
    return getWorker(env).fetch(request, env, ctx)
  },
  scheduled(controller: ScheduledController, env: W05Env, ctx: W05Context): void {
    const task = (async () => {
      const db = getW05MessagingOutboxDatabase(env)
      const result = await dispatchMessagingOutboxBatch(db, env.MESSAGING_REALTIME_HUB, 25)
      if (Math.floor(controller.scheduledTime / 60_000) % 15 === 0) {
        await pruneDeliveredMessagingOutbox(db, 500)
      }
      if (result.retried > 0) {
        console.warn(JSON.stringify({ event: 'w05.messaging.outbox.retry', claimed: result.claimed, delivered: result.delivered, retried: result.retried }))
      }
    })().catch((error) => {
      console.error(JSON.stringify({ event: 'w05.messaging.outbox.failed', errorType: error instanceof Error ? error.name : 'UNKNOWN' }))
    })
    ctx.waitUntil(task)
  },
}
