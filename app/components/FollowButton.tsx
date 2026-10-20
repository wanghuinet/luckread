import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity } from 'react-native';
import { useColorScheme } from 'nativewind';
import {
  getUserFollowSnapshot,
  resolveUserProfileId,
  useUserFollow,
} from '~/lib/user-follow-state';

type FollowButtonProps = {
  targetUserId?: string;
  targetUsername?: string;
};

export default function FollowButton({ targetUserId, targetUsername }: FollowButtonProps) {
  const { colorScheme } = useColorScheme();
  const [resolvedTargetId, setResolvedTargetId] = useState(targetUserId?.trim() ?? '');
  const [resolvingProfile, setResolvingProfile] = useState(!targetUserId?.trim());
  const [profileResolutionError, setProfileResolutionError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const {
    following,
    loaded,
    loading,
    pending,
    error,
    refreshStatus,
    toggleFollow,
  } = useUserFollow(resolvedTargetId || undefined);

  const resolveTarget = useCallback(async (): Promise<{ id: string | null; status?: number; message?: string }> => {
    const directId = targetUserId?.trim();
    if (directId) {
      setResolvedTargetId(directId);
      setProfileResolutionError('');
      setResolvingProfile(false);
      return { id: directId };
    }

    setResolvedTargetId('');
    setResolvingProfile(true);
    setProfileResolutionError('');
    const result = await resolveUserProfileId(targetUsername);
    setResolvingProfile(false);
    if (result.id) {
      setResolvedTargetId(result.id);
      setProfileResolutionError('');
      return result;
    }

    setProfileResolutionError(result.message ?? 'Could not resolve this LuckRead profile.');
    return result;
  }, [targetUserId, targetUsername]);

  useEffect(() => {
    void resolveTarget();
  }, [resolveTarget]);

  const dark = colorScheme === 'dark';
  const noTargetInput = !targetUserId?.trim() && !targetUsername?.trim();
  const disabled = noTargetInput || resolvingProfile || loading || pending || retrying;
  const label = resolvingProfile || loading || retrying
    ? 'Loading…'
    : pending
      ? 'Saving…'
      : profileResolutionError || !loaded
        ? 'Retry'
        : following
          ? 'Following'
          : 'Follow';

  async function handlePress() {
    if (noTargetInput || resolvingProfile || loading || pending || retrying) return;

    if (profileResolutionError || !resolvedTargetId) {
      setRetrying(true);
      const result = await resolveTarget();
      setRetrying(false);
      if (!result.id) {
        Alert.alert(
          result.status === 404 ? 'Profile not found' : 'Unable to load profile',
          result.message || 'Please try again.',
        );
      }
      return;
    }

    if (!loaded) {
      setRetrying(true);
      await refreshStatus();
      setRetrying(false);
      const latest = getUserFollowSnapshot(resolvedTargetId);
      if (!latest.loaded && latest.error) {
        Alert.alert('Unable to load follow status', latest.error);
      }
      return;
    }

    const result = await toggleFollow();
    if (!result.ok) {
      Alert.alert(
        result.status === 401 ? 'Sign in required' : 'Follow update failed',
        result.message || error || 'Please try again.',
      );
    }
  }

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: loaded && following }}
      disabled={disabled}
      onPress={() => void handlePress()}
      className={
        loaded && following
          ? 'min-w-[104px] items-center rounded-full border border-neutral-300 bg-transparent px-5 py-2 dark:border-neutral-600'
          : 'min-w-[104px] items-center rounded-full bg-black px-5 py-2 dark:bg-white'
      }
    >
      {resolvingProfile || loading || retrying || pending ? (
        <ActivityIndicator
          size="small"
          color={dark && loaded && following ? '#e7e9ea' : dark ? '#000000' : loaded && following ? '#0f1419' : '#ffffff'}
        />
      ) : (
        <Text
          className={
            loaded && following
              ? 'font-bold text-black dark:text-white'
              : 'font-bold text-white dark:text-black'
          }
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}
