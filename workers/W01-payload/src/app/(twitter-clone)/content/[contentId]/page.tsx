import type { Metadata } from 'next'

import {
  generateLegacyContentMetadata,
  renderLegacyContentRoute,
} from '../../../(frontend)/content/PublicContentRoutes'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contentId: string }>
}): Promise<Metadata> {
  const { contentId } = await params
  return generateLegacyContentMetadata(contentId)
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>
}) {
  const { contentId } = await params
  return renderLegacyContentRoute(contentId)
}
