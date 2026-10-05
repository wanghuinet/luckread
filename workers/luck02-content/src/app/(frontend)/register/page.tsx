import './register.css'

import RegisterForm from './RegisterForm'
import devPolicy from '../../../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'
import prodPolicy from '../../../../../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'

const runtimeEnvironment =
  process.env.CLOUDFLARE_ENV ??
  (process.env.NODE_ENV === 'production' ? 'production' : 'development')

const policyVersion =
  runtimeEnvironment.toLowerCase() === 'production'
    ? prodPolicy.policyVersion
    : devPolicy.policyVersion

export default function RegisterPage() {
  return <RegisterForm policyVersion={policyVersion} />
}
