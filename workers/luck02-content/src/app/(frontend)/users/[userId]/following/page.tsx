import UserFollowList from '../UserFollowList'

export default async function UserFollowingPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  return <UserFollowList direction="following" userId={userId} />
}
