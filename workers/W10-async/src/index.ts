import { MembershipRenewalWorkflow } from './membership-renewal-workflow.js'

export { MembershipRenewalWorkflow }

export default {
  // W10 is invoked by its scheduled Workflow binding and is not a public API.
  async fetch(): Promise<Response> {
    return new Response(null, { status: 404 })
  },
}
