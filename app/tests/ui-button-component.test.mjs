import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const button = readFileSync(new URL('../components/ui/button.tsx', import.meta.url), 'utf8');
const text = readFileSync(new URL('../components/ui/text.tsx', import.meta.url), 'utf8');
const follow = readFileSync(new URL('../components/FollowButton.tsx', import.meta.url), 'utf8');
const utils = readFileSync(new URL('../lib/utils.ts', import.meta.url), 'utf8');

test('Reusables Button provides semantic variants and accessible native Pressable behavior', () => {
  for (const variant of ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']) {
    expect(button).toContain(variant + ':');
  }
  for (const size of ['default', 'sm', 'lg', 'icon']) {
    expect(button).toContain(size + ':');
  }
  expect(button).toContain("accessibilityRole=\"button\"");
  expect(button).toContain("props.disabled && 'opacity-50'");
  expect(button).toContain('TextClassContext.Provider');
  expect(button).toContain('buttonTextVariants');
});

test('shared Text primitive supports semantic text variants and slot composition', () => {
  expect(text).toContain("from '@rn-primitives/slot'");
  expect(text).toContain('asChild = false');
  expect(text).toContain('TextClassContext');
  expect(text).toContain("h1: 'heading'");
  expect(text).toContain("muted: 'text-neutral-500 dark:text-neutral-400 text-sm'");
});

test('class merge helper is based on the official Reusables clsx and tailwind-merge pattern', () => {
  expect(utils).toContain("from 'clsx'");
  expect(utils).toContain("from 'tailwind-merge'");
  expect(utils).toContain('twMerge(clsx(inputs))');
});

test('Follow action consumes the shared Button primitive and preserves its existing loading and state labels', () => {
  expect(follow).toContain("import { Button } from '~/components/ui/button'");
  expect(follow).toContain("import { Text } from '~/components/ui/text'");
  expect(follow).toContain('<Button');
  expect(follow).toContain("variant={loaded && following ? 'outline' : 'default'}");
  expect(follow).toContain("accessibilityState={{ disabled, selected: loaded && following }}");
  expect(follow).toContain("{label}");
  expect(follow).not.toContain('<TouchableOpacity');
});
