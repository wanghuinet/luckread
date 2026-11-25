import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const profile = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx', import.meta.url),
  'utf8',
);

test('profile data reloads when the screen regains focus and aborts stale requests on blur', () => {
  expect(profile).toContain("import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';");
  expect(profile).toContain('useFocusEffect(');
  expect(profile).toContain('void loadProfile();');
  expect(profile).toContain('setRepliesLoadedForUserId(null);');
  expect(profile).toContain('setMediaLoadedForUserId(null);');
  expect(profile).toContain('setLikesLoadedForUserId(null);');
  expect(profile).toContain('requestRef.current?.abort();');
  expect(profile).toContain('likesRequestRef.current?.abort();');
  expect(profile).toContain('repliesRequestRef.current?.abort();');
  expect(profile).toContain('mediaRequestRef.current?.abort();');
  expect(profile).not.toContain('useEffect(() => {\n    void loadProfile();');
});
