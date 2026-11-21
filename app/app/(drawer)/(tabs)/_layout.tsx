import { Tabs } from 'expo-router';

import XBottomTabBar from '~/components/XBottomTabBar';
import { TabBarScrollProvider } from '~/components/TabBarScroll';

function TabNavigator() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <XBottomTabBar {...props} />}
    >
      <Tabs.Screen name="(index)" />
      <Tabs.Screen name="(search)" />
      <Tabs.Screen name="(video)" />
      <Tabs.Screen name="(notifications)" />
      <Tabs.Screen name="(messages)" />
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
