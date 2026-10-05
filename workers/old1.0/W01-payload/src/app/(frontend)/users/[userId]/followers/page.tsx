import UserFollowList from '../UserFollowList'

export default async function UserFollowersPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  return <UserFollowList direction="followers" userId={userId} />
}
