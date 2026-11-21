import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/auth-store';

export default function Home() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);

  useEffect(() => {
    if (authStatus === 'authenticated') {
      router.replace('/(drawer)/(tabs)/(index)' as never);
    }
  }, [authStatus, router]);

  if (authStatus === 'loading' || authStatus === 'authenticated') {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator color="#1d9bf0" />
        <Text className="mt-3 text-sm text-neutral-500">正在打开 LuckRead…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 justify-center bg-white px-8 dark:bg-black">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-sky-500">
        <Feather name="book-open" size={30} color="#fff" />
      </View>
      <Text className="mt-8 text-4xl font-extrabold tracking-tight text-neutral-900 dark:text-white">LuckRead</Text>
      <Text className="mt-3 text-2xl font-bold text-neutral-900 dark:text-white">发现值得阅读的内容</Text>
      <Text className="mt-3 text-base leading-6 text-neutral-500">
        发布动态、分享图片和短视频，并关注你感兴趣的创作者。
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/login' as never)}
        className="mt-8 items-center rounded-full bg-sky-500 px-6 py-4"
      >
        <Text className="text-base font-bold text-white">登录或注册</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/(drawer)/(tabs)/(index)' as never)}
        className="mt-3 items-center rounded-full border border-neutral-300 px-6 py-4 dark:border-neutral-700"
      >
        <Text className="text-base font-semibold text-neutral-800 dark:text-neutral-100">浏览公开动态</Text>
      </Pressable>
    </View>
  );
}
