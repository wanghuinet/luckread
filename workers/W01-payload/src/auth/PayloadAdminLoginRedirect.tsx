import type { AdminViewServerProps } from 'payload'
import { redirect } from 'next/navigation'

const safeReturnTo = (value: unknown): string => {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' &&
    candidate.startsWith('/admin') &&
    !candidate.startsWith('//')
    ? candidate
    : '/admin'
}

export default function PayloadAdminLoginRedirect({
  searchParams,
}: AdminViewServerProps) {
  const returnTo = safeReturnTo(searchParams?.returnTo ?? searchParams?.redirect)
  redirect('/login?returnTo=' + encodeURIComponent(returnTo))
}
