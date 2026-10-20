import { Alert, Text, TouchableOpacity } from 'react-native';
import Repost from '~/assets/svg/repost.svg';
import { useContentRepost } from '~/lib/content-repost-state';

type RepostButtonProps = {
  contentId?: string;
  initialCount?: number;
  initialReposted?: boolean;
  iconColor: string;
  textColor: string;
};

export default function RepostButton({
  contentId,
  initialCount,
  initialReposted,
  iconColor,
  textColor,
}: RepostButtonProps) {
  const {
    reposted,
    repostCount,
    loading,
    pending,
    toggleRepost,
  } = useContentRepost(contentId, initialCount, initialReposted);

  const handlePress = async () => {
    if (!contentId || loading || pending) return;
    const result = await toggleRepost();
    if (result.ok) return;

    const title = result.status === 401
      ? 'Sign in required'
      : result.status === 403
        ? 'Action not allowed'
        : result.status === 409
          ? 'Repost could not be updated'
          : result.status === 429
            ? 'Please slow down'
            : 'Repost failed';
    Alert.alert(title, result.message || 'Please try again.');
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={reposted ? 'Undo repost' : 'Repost'}
      accessibilityState={{ disabled: !contentId || loading || pending, selected: reposted }}
      className="flex-row items-center gap-1.5"
      disabled={!contentId || loading || pending}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Repost width={18} height={18} fill={reposted ? '#00ba7c' : iconColor} />
      <Text className={textColor} style={reposted ? { color: '#00ba7c' } : undefined}>
        {repostCount ?? initialCount ?? 0}
      </Text>
    </TouchableOpacity>
  );
}
