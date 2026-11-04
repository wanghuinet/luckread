/// <reference types="@cloudflare/workers-types" />
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import {
  runScheduledNotificationPush,
  type NotificationPushDeliveryEnv,
} from './notification-push-workflow-runtime.js'

export class NotificationPushWorkflow extends WorkflowEntrypoint<NotificationPushDeliveryEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    return runScheduledNotificationPush(
      this.env,
      event.schedule,
      (name, options, callback) => step.do(name, options, callback),
    )
  }
}
