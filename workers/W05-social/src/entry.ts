import worker from './index.js'
import { NotificationPushWorkflow } from './notification-push-workflow.js'

// Keep the HTTP router importable in Node/Vitest tests. Cloudflare's virtual
// Workflow runtime module is loaded only by the actual deploy entrypoint.
export { NotificationPushWorkflow }
export default worker
