import React from 'react';
import { Pressable, StatusBar, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '~/store/auth-store';

export default function Messages() {
  const router = useRouter();
  const authStatus = useAuthStore((state) => state.status);

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <StatusBar barStyle="dark-content" />
      <View className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <Text className="text-xl font-bold text-neutral-900 dark:text-white">私信</Text>
        <Feather name="mail" size={22} color="#1d9bf0" />
      </View>
      <View className="flex-1 items-center justify-center px-8">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/40">
          <Feather name="message-circle" size={30} color="#1d9bf0" />
        </View>
        <Text className="mt-5 text-lg font-bold text-neutral-900 dark:text-white">私信功能暂未开放</Text>
        <Text className="mt-2 text-center text-sm leading-6 text-neutral-500">
          当前版本尚无可用的会话与消息 API，因此不会展示虚构的会话、消息请求或未读状态。
        </Text>
        {authStatus !== 'authenticated' ? (
          <Pressable onPress={() => router.push('/login' as never)} className="mt-5 rounded-full bg-sky-500 px-6 py-3">
            <Text className="font-bold text-white">登录</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
