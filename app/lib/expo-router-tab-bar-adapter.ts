import type { TabBarNavigation } from 'react-native-floating-glass-tabbar';

type ExpoRouterTabRoute = {
  key: string;
  name: string;
};

type ExpoRouterTabEmitter = {
  emit?: (event: Parameters<TabBarNavigation['emit']>[0]) => ReturnType<TabBarNavigation['emit']>;
} | null | undefined;

export function createExpoRouterTabBarNavigation({
  routes,
  emitter,
  navigateToTab,
}: {
  routes: readonly ExpoRouterTabRoute[];
  emitter?: ExpoRouterTabEmitter;
  navigateToTab: (routeKey: string) => void;
}): TabBarNavigation {
  return {
    emit: (event) => typeof emitter?.emit === 'function'
      ? emitter.emit(event)
      : { type: event.type, defaultPrevented: false },
    navigate: (routeName) => {
      const route = routes.find((candidate) => candidate.name === routeName);
      if (route) {
        navigateToTab(route.key);
      }
    },
  };
}
