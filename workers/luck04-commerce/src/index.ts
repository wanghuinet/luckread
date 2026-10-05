/// <reference types="@cloudflare/workers-types" />

import commerceHandler from './commerce/index.js'
import governanceHandler from './governance/index.js'

type CommerceEnv = Parameters<typeof commerceHandler.fetch>[1]
type GovernanceEnv = Parameters<typeof governanceHandler.fetch>[1]
type CombinedEnv = CommerceEnv & GovernanceEnv

export default {
  async fetch(request: Request, env: CombinedEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (
      pathname === '/reports' ||
      pathname.startsWith('/admin/moderation/') ||
      pathname === '/internal/audit-events/account-state-changed'
    ) {
      return governanceHandler.fetch(request, env as GovernanceEnv)
    }
    return commerceHandler.fetch(request, env as CommerceEnv)
  },

  async scheduled(controller: ScheduledController, env: CombinedEnv): Promise<void> {
    if (typeof governanceHandler.scheduled === 'function') {
      await governanceHandler.scheduled(controller, env as GovernanceEnv)
    }
  },

  async queue(batch: MessageBatch<unknown>, env: CombinedEnv): Promise<void> {
    if (typeof governanceHandler.queue === 'function') {
      await governanceHandler.queue(batch, env as GovernanceEnv)
    }
  },
}
