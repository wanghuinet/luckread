import UserProfilePage from '../../../(frontend)/users/[userId]/UserProfilePage'

export default function PublicUserProfileRoute({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  return <UserProfilePage params={params} />
}
