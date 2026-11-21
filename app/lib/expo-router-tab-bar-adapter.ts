export type ExpoRouterTabRoute = {
  key: string;
  name: string;
};

export type ExpoRouterTabEvent =
  | { type: 'tabPress'; target: string; canPreventDefault: true }
  | { type: 'tabLongPress'; target: string };

type ExpoRouterTabEmitter = {
  emit?: (event: ExpoRouterTabEvent) => { type: string; defaultPrevented?: boolean } | undefined;
};

export type ExpoRouterTabBarNavigation = {
  emit: (event: ExpoRouterTabEvent) => { type: string; defaultPrevented: boolean };
  navigate: (routeName: string) => void;
};

export function createExpoRouterTabBarNavigation({
  routes,
  emitter,
  navigateToTab,
}: {
  routes: readonly ExpoRouterTabRoute[];
  emitter?: ExpoRouterTabEmitter;
  navigateToTab: (routeKey: string) => void;
}): ExpoRouterTabBarNavigation {
  return {
    emit: (event) => {
      const result = typeof emitter?.emit === 'function' ? emitter.emit(event) : undefined;
      return { type: event.type, defaultPrevented: result?.defaultPrevented === true };
    },
    navigate: (routeName) => {
      const route = routes.find((candidate) => candidate.name === routeName);
      if (route) navigateToTab(route.key);
    },
  };
}
