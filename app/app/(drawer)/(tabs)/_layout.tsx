import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { TabBarScrollProvider, useTabBarScrollState } from '~/components/TabBarScroll';
import { BlurView } from 'expo-blur';

import Home from "~/assets/svg/tabs/home.svg"
import FilledHome from "~/assets/svg/tabs/filled/home.svg"
import Search from "~/assets/svg/tabs/search.svg"
import FilledSearch from "~/assets/svg/tabs/filled/search.svg"
import Notifications from "~/assets/svg/tabs/notifications.svg"
import FilledNotifications from "~/assets/svg/tabs/filled/notifications.svg"
import Messages from "~/assets/svg/tabs/messages.svg"
import FilledMessages from "~/assets/svg/tabs/filled/messages.svg"
import Foundation from '@expo/vector-icons/Foundation';
import { Platform } from 'react-native';
import { View } from 'react-native';
import { useColorScheme } from "nativewind";






const TabBarBackground = () => {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (Platform.OS === 'ios') {
    return (
      <BlurView
        tint={isDark ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
        intensity={40}
        style={StyleSheet.absoluteFill}
      />
    );
  }

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: isDark ? '#000000' : '#ffffff' },
      ]}
    />
  );
};


function TabNavigator() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { tabBarTranslateY } = useTabBarScrollState();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: isDark ? '#ffffff' : '#000000',
        tabBarInactiveTintColor: isDark ? '#9ca3af' : '#6b7280',
        tabBarShowLabel: false,
        tabBarBackground: () => <TabBarBackground />,
        tabBarStyle: [
          {
            position: 'absolute',
            borderTopWidth: 0,
            elevation: 0,
            backgroundColor: 'transparent',
            paddingTop: 4,
          },
          route.name === '(video)' ? { display: 'none' } : {},
          { transform: [{ translateY: tabBarTranslateY }] } as any,
        ],
      })}
    >


      <Tabs.Screen
        name="(index)"
        options={{
          headerShown: false,
          tabBarIcon: ({ focused, color }) => focused ? <FilledHome width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} /> : <Home width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} />,
        }}
      />

      <Tabs.Screen
        name="(search)"
        options={{
          headerShown: false,
          tabBarIcon: ({ focused, color }) => focused ? <FilledSearch width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} /> : <Search width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} />,
        }}
      />

      <Tabs.Screen
        name="(video)"
        options={{
          tabBarIcon: ({ color }) => <Foundation name="play-circle" size={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} />,
        }}
      />
      <Tabs.Screen
        name="(notifications)"
        options={{
          tabBarIcon: ({ focused, color }) => focused ? <FilledNotifications width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} /> : <Notifications width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} />,
        }}
      />
      <Tabs.Screen
        name="(messages)"
        options={{
          tabBarIcon: ({ focused, color }) => focused ? <FilledMessages width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} /> : <Messages width={26} height={26} color={typeof color === 'string' ? color : (isDark ? '#ffffff' : '#111827')} />,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <TabBarScrollProvider>
      <TabNavigator />
    </TabBarScrollProvider>
  );
}
