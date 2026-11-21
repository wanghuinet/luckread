/// <reference types="@cloudflare/workers-types" />
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { runScheduledNotificationPush } from './notification-push-workflow-runtime.js'
import { getW05NotificationPushDeliveryDependencies } from './neon/runtime.js'
import type { NotificationPushDeliveryEnv } from './notification-push-delivery-runtime.js'

export class NotificationPushWorkflow extends WorkflowEntrypoint<NotificationPushDeliveryEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const dependencies = this.env.PUSH_DELIVERY_ENABLED === 'true'
      ? getW05NotificationPushDeliveryDependencies(this.env)
      : {}
    return runScheduledNotificationPush(
      this.env,
      event.schedule,
      (name, options, callback) => step.do(name, options, callback),
      dependencies,
    )
  }
}
