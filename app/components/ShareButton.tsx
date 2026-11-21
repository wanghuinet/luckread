import { useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
  TouchableOpacity,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
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

  async function copyLink(url: string) {
    try {
      const copied = await Clipboard.setStringAsync(url);
      if (copied === false) {
        throw new Error('The link could not be copied. Please try again.');
      }
      Alert.alert('Link copied', 'The public LuckRead link is ready to paste.');
    } catch (cause) {
      Alert.alert(
        'Copy failed',
        cause instanceof Error ? cause.message : 'Could not copy this LuckRead link. Please try again.',
      );
    }
  }

  async function openNativeShare(message: string) {
    try {
      await Share.share({ message, title: 'Share on LuckRead' });
    } catch (cause) {
      Alert.alert(
        'Share failed',
        cause instanceof Error ? cause.message : 'Could not open the native share sheet. Please try again.',
      );
    }
  }

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

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['Copy link', 'More sharing options', 'Cancel'],
            cancelButtonIndex: 2,
            userInterfaceStyle: colorScheme === 'dark' ? 'dark' : 'light',
          },
          (buttonIndex) => {
            if (buttonIndex === 0) void copyLink(result.url);
            if (buttonIndex === 1) void openNativeShare(message);
          },
        );
      } else {
        Alert.alert('Share post', 'Choose how to share this LuckRead link.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Copy link', onPress: () => { void copyLink(result.url); } },
          { text: 'More sharing options', onPress: () => { void openNativeShare(message); } },
        ]);
      }
    } catch (cause) {
      Alert.alert(
        'Share failed',
        cause instanceof Error ? cause.message : 'Could not create a share link. Please try again.',
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Share or copy post link"
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
