
const { getPostHogExpoConfig } = require('posthog-react-native/metro');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */

// Inject PostHog debug IDs into Expo/Hermes bundles so uploaded source maps
// can be matched to runtime exceptions in Error Tracking.
const config = getPostHogExpoConfig(__dirname);

const { transformer, resolver } = config;

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve("react-native-svg-transformer/expo")
};
config.resolver = {
  ...resolver,
  assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
  sourceExts: [...resolver.sourceExts, "svg"]
};

module.exports = withNativeWind(config, { input: './global.css' });
