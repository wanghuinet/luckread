declare module 'react-native-animated-splash-screen' {
  import type { ComponentType, ReactNode } from 'react';
  import type { ImageSourcePropType } from 'react-native';

  const AnimatedSplash: ComponentType<{
    translucent?: boolean;
    isLoaded: boolean;
    logoImage?: ImageSourcePropType;
    backgroundColor?: string;
    logoHeight?: number;
    logoWidth?: number;
    children?: ReactNode;
  }>;

  export default AnimatedSplash;
}
