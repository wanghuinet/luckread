import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers'
import {
  runMembershipRenewalWorkflow,
  type MembershipRenewalWorkflowEnv,
} from './membership-renewal-workflow-runtime.js'

export class MembershipRenewalWorkflow extends WorkflowEntrypoint<
  MembershipRenewalWorkflowEnv,
  unknown
> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    return runMembershipRenewalWorkflow(
      this.env,
      event.schedule,
      (name, options, callback) => step.do(name, options, callback) as Promise<unknown>,
    )
  }
}
