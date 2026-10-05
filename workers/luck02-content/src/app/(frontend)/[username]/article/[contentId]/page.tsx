import ContentDetailPage from '../../../content/[contentId]/page'

export default async function UsernameArticlePage({
  params,
}: {
  params: Promise<{ username: string; contentId: string }>
}) {
  const { contentId } = await params
  return <ContentDetailPage params={Promise.resolve({ contentId })} />
}
