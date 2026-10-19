import UserFollowList from '../../../../(frontend)/users/[userId]/UserFollowList'

export default async function UserFollowersPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  return <UserFollowList direction="followers" userId={userId} />
}
