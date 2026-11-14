import { createW05SocialWorker } from './index.js'
import { getW05SocialWorkerDependencies } from './neon/runtime.js'
import { NotificationPushWorkflow } from './notification-push-workflow.js'

// Keep Cloudflare's virtual Workflow runtime module in the deploy entry only.
export { NotificationPushWorkflow }

type W05Worker = ReturnType<typeof createW05SocialWorker>
type W05Env = Parameters<W05Worker['fetch']>[1]
type W05Context = Parameters<W05Worker['fetch']>[2]

const workers = new WeakMap<object, W05Worker>()

function getWorker(env: W05Env): W05Worker {
  const key = env as object
  const cached = workers.get(key)
  if (cached) return cached

  const worker = createW05SocialWorker(getW05SocialWorkerDependencies(env))
  workers.set(key, worker)
  return worker
}

export default {
  fetch(request: Request, env: W05Env, ctx: W05Context): Promise<Response> {
    return getWorker(env).fetch(request, env, ctx)
  },
}
