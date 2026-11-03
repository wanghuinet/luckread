const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

module.exports = ({ config }) => {
  if (!config || typeof config !== 'object') {
    throw new Error('LuckRead Expo config is required.');
  }

  const projectId = String(
    process.env.EXPO_PROJECT_ID || config.extra?.eas?.projectId || '',
  ).trim();
  const requireProjectId = /^(1|true)$/i.test(
    String(process.env.LUCKREAD_REQUIRE_OTA_CONFIG || ''),
  );
  const runtimeVersion = String(process.env.LUCKREAD_RUNTIME_VERSION || '').trim();
  const updateChannel = String(process.env.EXPO_UPDATE_CHANNEL || 'production').trim();

  if (projectId && !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('EXPO_PROJECT_ID must be a valid Expo EAS project UUID.');
  }
  if (requireProjectId && !projectId) {
    throw new Error(
      'OTA is required for this build. Configure the GitHub repository variable EXPO_PROJECT_ID (or secret EXPO_PROJECT_ID).',
    );
  }
  if (runtimeVersion && !VERSION_PATTERN.test(runtimeVersion)) {
    throw new Error(
      'LUCKREAD_RUNTIME_VERSION must match the installed APK app version, for example 1.0.0-beta.123.',
    );
  }
  if (!CHANNEL_PATTERN.test(updateChannel)) {
    throw new Error('EXPO_UPDATE_CHANNEL contains unsupported characters.');
  }

  const updatesEnabled = Boolean(projectId);
  const resolvedConfig = {
    ...config,
    ...(runtimeVersion ? { version: runtimeVersion } : {}),
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      ...config.updates,
      enabled: updatesEnabled,
      ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      ...(projectId
        ? {
            requestHeaders: {
              ...config.updates?.requestHeaders,
              'expo-channel-name': updateChannel,
            },
          }
        : {}),
    },
  };

  if (projectId) {
    resolvedConfig.extra = {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId,
      },
    };
  }

  return resolvedConfig;
};
