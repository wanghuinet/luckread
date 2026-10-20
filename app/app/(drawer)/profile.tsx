import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiRequest } from '~/lib/api-client';
import { unwrapApiData } from '~/lib/content-adapter';
import { useAuthStore } from '~/store/auth-store';

type PublicProfile = {
  id: string;
  username?: string;
};

export default function MyProfileEntry() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const [error, setError] = useState('');

  const openProfile = useCallback(async () => {
    if (!user?.id) {
      router.replace('/login' as never);
      return;
    }
    setError('');
    try {
      const result = await apiRequest<unknown>('/users/' + encodeURIComponent(user.id), { method: 'GET' });
      if (!result.response.ok) {
        throw new Error(result.error?.message || '无法读取个人资料。');
      }
      const profile = unwrapApiData<PublicProfile>(result.data);
      router.replace(('/profile/' + encodeURIComponent(profile?.username || user.id)) as never);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取个人资料。');
    }
  }, [router, user?.id]);

  useEffect(() => {
    if (authStatus === 'anonymous') router.replace('/login' as never);
    if (authStatus === 'authenticated') void openProfile();
  }, [authStatus, openProfile, router]);

  return (
    <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
      {error ? (
        <>
          <Text className="text-center text-sm text-red-600">{error}</Text>
          <Pressable onPress={() => void openProfile()} className="mt-4 rounded-full bg-sky-500 px-5 py-3">
            <Text className="font-bold text-white">重试</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color="#1d9bf0" />
          <Text className="mt-3 text-sm text-neutral-500">正在打开个人主页…</Text>
        </>
      )}
    </View>
  );
}
