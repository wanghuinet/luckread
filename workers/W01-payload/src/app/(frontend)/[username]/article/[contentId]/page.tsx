import { permanentRedirect } from 'next/navigation'

export default async function UsernameArticlePage({
  params,
}: {
  params: Promise<{ username: string; contentId: string }>
}) {
  const { contentId } = await params
  permanentRedirect('/content/' + encodeURIComponent(contentId))
}
