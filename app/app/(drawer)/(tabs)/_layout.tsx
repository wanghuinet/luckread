import { Tabs } from 'expo-router';
import { Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

import { TabBarIcon } from '~/components/TabBarIcon';

import Home from "~/assets/svg/tabs/home.svg"
import FilledHome from "~/assets/svg/tabs/filled/home.svg"
import Search from "~/assets/svg/tabs/search.svg"
import FilledSearch from "~/assets/svg/tabs/filled/search.svg"
import Grok from "~/assets/svg/tabs/grok.svg"
import FilledGrok from "~/assets/svg/tabs/filled/grok.svg"
import Notifications from "~/assets/svg/tabs/notifications.svg"
import FilledNotifications from "~/assets/svg/tabs/filled/notifications.svg"
import Messages from "~/assets/svg/tabs/messages.svg"
import FilledMessages from "~/assets/svg/tabs/filled/messages.svg"
import Foundation from '@expo/vector-icons/Foundation';
import { Platform } from 'react-native';
import { View } from 'react-native';
import { useColorScheme } from "nativewind";




const TabBarBackground = () => {
  const isDark = useColorScheme() === 'dark';
  const BackgroundComponent = Platform.OS === 'ios' ? BlurView : View
  const backgroundProps =
    Platform.OS === 'ios'
      ? {
        tint: isDark ? 'systemThickMaterialDark' : 'systemThickMaterialLight',
        
        intensity: 40,
        style: StyleSheet.absoluteFill,
      }
      : {
        style: {
          backgroundColor: isDark ? '#1e1e1e' : '#fff',
          ...StyleSheet.absoluteFill,
        },
      }

  return <BackgroundComponent {...backgroundProps} />
}



export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: 'black',
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
        ],
      })}
    >


      <Tabs.Screen
        name="(index)"
        options={{
          headerShown: false,
          tabBarIcon: ({ focused, color }) => focused ? <FilledHome width={26} height={26} color={color} /> : <Home width={26} height={26} color={color} />,
        }}
      />

      <Tabs.Screen
        name="(search)"
        options={{
          headerShown: false,
          tabBarIcon: ({ focused, color }) => focused ? <FilledSearch width={26} height={26} color={color} /> : <Search width={26} height={26} color={color} />,
        }}
      />

      <Tabs.Screen
        name="(video)"
        options={{
          tabBarIcon: ({ color }) => <Foundation name="play-circle" size={26} color={'#000'} />,
        }}
      />

      <Tabs.Screen
        name="(grok)"
        options={{
          tabBarIcon: ({ focused, color }) => focused ? <FilledGrok width={26} height={26} color={color} /> : <Grok width={26} height={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(notifications)"
        options={{
          tabBarIcon: ({ focused, color }) => focused ? <FilledNotifications width={26} height={26} color={color} /> : <Notifications width={26} height={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(messages)"
        options={{
          tabBarIcon: ({ focused, color }) => focused ? <FilledMessages width={26} height={26} color={color} /> : <Messages width={26} height={26} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
