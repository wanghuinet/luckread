import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildPublicProfileUrl } from '../lib/public-profile-url';

const profileScreen = readFileSync(
  new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx', import.meta.url),
  'utf8',
);

test('builds the public W01 profile route from the Payload profile ID', () => {
  expect(buildPublicProfileUrl('payload-user-123')).toBe(
    'https://luckread.com/users/payload-user-123',
  );
  expect(buildPublicProfileUrl(' user/name ')).toBe(
    'https://luckread.com/users/user%2Fname',
  );
});

test('rejects absent, non-string and overlong profile IDs', () => {
  expect(buildPublicProfileUrl('')).toBeNull();
  expect(buildPublicProfileUrl('   ')).toBeNull();
  expect(buildPublicProfileUrl(null)).toBeNull();
  expect(buildPublicProfileUrl(123)).toBeNull();
  expect(buildPublicProfileUrl('x'.repeat(129))).toBeNull();
});

test('profile header uses real search and native share actions, not a fake Grok route', () => {
  expect(profileScreen).toContain("router.push('/search' as never)");
  expect(profileScreen).toContain('buildPublicProfileUrl(user.public_profile_id)');
  expect(profileScreen).toContain('public_profile_id: profile.id');
  expect(profileScreen).toContain('NativeShare.share({ message: url, title:');
  expect(profileScreen).toContain('accessibilityLabel="Share profile"');
  expect(profileScreen).not.toContain('<Grok');
});

test('profile content tabs expose their selected accessibility state', () => {
  expect(profileScreen).toContain('accessibilityRole="tab"');
  expect(profileScreen).toContain('accessibilityState={{ selected: selectedTabIndex === index }}');
  expect(profileScreen).toContain('testID={`profile-tab-${tabName.toLowerCase()}`}');
});
