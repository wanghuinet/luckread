import { useState } from 'react';
import { ActivityIndicator, Alert, Share, TouchableOpacity } from 'react-native';
import { useColorScheme } from 'nativewind';
import { Feather } from '@expo/vector-icons';
import { createContentShareLink } from '~/lib/content-share';

type ShareButtonProps = {
  contentId?: string;
  contentText?: string;
  iconColor: string;
};

export default function ShareButton({ contentId, contentText, iconColor }: ShareButtonProps) {
  const { colorScheme } = useColorScheme();
  const [sharing, setSharing] = useState(false);
  const disabled = !contentId?.trim() || sharing;
  const activityColor = colorScheme === 'dark' ? '#8b98a5' : '#536471';

  async function handlePress() {
    if (!contentId?.trim() || sharing) return;

    setSharing(true);
    try {
      const result = await createContentShareLink(contentId);
      if (!result.ok) {
        Alert.alert(
          result.status === 401 ? 'Sign in required' : 'Share failed',
          result.message || 'Could not create a share link. Please try again.',
        );
        return;
      }

      const preview = contentText?.trim();
      const message = preview
        ? preview + '\n\n' + result.url
        : 'Check out this post on LuckRead:\n' + result.url;
      await Share.share({ message, title: 'Share on LuckRead' });
    } catch (cause) {
      Alert.alert(
        'Share failed',
        cause instanceof Error ? cause.message : 'Could not open the native share sheet. Please try again.',
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Share post"
      accessibilityState={{ disabled }}
      className="flex-row items-center gap-1.5"
      disabled={disabled}
      onPress={() => void handlePress()}
      activeOpacity={0.7}
    >
      {sharing
        ? <ActivityIndicator size="small" color={activityColor} />
        : <Feather name="share" size={18} color={iconColor} />}
    </TouchableOpacity>
  );
}
