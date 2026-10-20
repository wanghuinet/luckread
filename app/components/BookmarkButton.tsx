import { useState } from 'react';
import { ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { useColorScheme } from 'nativewind';
import Save from '~/assets/svg/save.svg';
import { useContentBookmark } from '~/lib/content-bookmark-state';

type BookmarkButtonProps = {
  contentId?: string;
  iconColor: string;
};

export default function BookmarkButton({ contentId, iconColor }: BookmarkButtonProps) {
  const { colorScheme } = useColorScheme();
  const { bookmarked, loading, pending, loaded, error, refreshStatus, toggleBookmark } = useContentBookmark(contentId);
  const [retrying, setRetrying] = useState(false);
  const dark = colorScheme === 'dark';
  const disabled = !contentId?.trim() || loading || pending || retrying;
  const activeColor = '#1d9bf0';

  async function handlePress() {
    if (!contentId?.trim() || loading || pending || retrying) return;

    if (!loaded) {
      setRetrying(true);
      await refreshStatus();
      setRetrying(false);
      return;
    }

    const result = await toggleBookmark();
    if (!result.ok) {
      Alert.alert(
        result.status === 401 ? 'Sign in required' : 'Bookmark failed',
        result.message || error || 'Please try again.',
      );
    }
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      accessibilityState={{ disabled, selected: loaded && bookmarked }}
      disabled={disabled}
      onPress={() => void handlePress()}
      className="flex-row items-center gap-1.5"
    >
      {loading || retrying || pending ? (
        <ActivityIndicator size="small" color={dark ? '#8b98a5' : '#536471'} />
      ) : (
        <Save width={18} height={18} fill={bookmarked ? activeColor : iconColor} />
      )}
    </TouchableOpacity>
  );
}
