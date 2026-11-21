import { useNetworkState } from 'expo-network';
import { useColorScheme } from 'nativewind';
import { StyleSheet, Text, View } from 'react-native';

import { isNetworkOffline } from '../lib/network-state';

export function NetworkStatusBanner() {
  const networkState = useNetworkState();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';

  if (!isNetworkOffline(networkState)) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel="网络连接不可用，部分内容可能无法更新"
      testID="network-status-offline-banner"
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#422006' : '#fef3c7',
          borderBottomColor: isDark ? '#78350f' : '#fcd34d',
        },
      ]}
    >
      <View
        accessible={false}
        style={[styles.indicator, { backgroundColor: isDark ? '#fbbf24' : '#b45309' }]}
      />
      <Text style={[styles.message, { color: isDark ? '#fde68a' : '#92400e' }]}>
        当前网络不可用，部分内容可能无法更新
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  indicator: {
    borderRadius: 4,
    height: 7,
    marginRight: 8,
    width: 7,
  },
  message: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
});
