import type { Metadata } from 'next'

import {
  generateCanonicalContentMetadata,
  renderCanonicalContentRoute,
} from '../../../content/PublicContentRoutes'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; contentId: string }>
}): Promise<Metadata> {
  const route = await params
  return generateCanonicalContentMetadata({ ...route, routeType: 'short' })
}

export default async function UsernameShortPage({
  params,
}: {
  params: Promise<{ username: string; contentId: string }>
}) {
  const route = await params
  return renderCanonicalContentRoute({ ...route, routeType: 'short' })
}
