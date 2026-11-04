import {
  runNotificationPushBatch,
  type NotificationPushBatchResult,
  type NotificationPushDeliveryEnv,
} from './notification-push-delivery-runtime.js'

export type NotificationPushSchedule = Readonly<{ cron: string; scheduledTime: number }>
export type NotificationPushStepRunner = (
  name: string,
  options: Readonly<{ retries: Readonly<{ limit: number; delay: '5 seconds'; backoff: 'exponential' }> }>,
  callback: () => Promise<NotificationPushBatchResult>,
) => Promise<NotificationPushBatchResult>

export async function runScheduledNotificationPush(
  env: NotificationPushDeliveryEnv,
  schedule: NotificationPushSchedule | undefined,
  runStep: NotificationPushStepRunner,
): Promise<NotificationPushBatchResult> {
  if (env.PUSH_DELIVERY_ENABLED !== 'true') return runNotificationPushBatch(env)
  if (!schedule || !Number.isSafeInteger(schedule.scheduledTime) || schedule.scheduledTime < 0 ||
      typeof schedule.cron !== 'string' || !schedule.cron.trim() || schedule.cron.length > 128) {
    throw new Error('W05_PUSH_DELIVERY_SCHEDULE_REQUIRED')
  }
  return runStep(
    'process-w05-notification-push-batch',
    { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
    () => runNotificationPushBatch(env),
  )
}
