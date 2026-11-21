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
  return generateCanonicalContentMetadata({ ...route, routeType: 'video' })
}

export default async function UsernameVideoPage({
  params,
}: {
  params: Promise<{ username: string; contentId: string }>
}) {
  const route = await params
  return renderCanonicalContentRoute({ ...route, routeType: 'video' })
}
