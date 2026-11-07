import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const tokens = readFileSync(new URL('../constants/x-design-tokens.ts', import.meta.url), 'utf8');
const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const engagement = readFileSync(new URL('../components/EngagementActions.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url), 'utf8');

test('centralizes X-inspired light/dark social surface tokens and type scale', () => {
  expect(tokens).toContain("background: '#ffffff'");
  expect(tokens).toContain("background: '#000000'");
  expect(tokens).toContain("text: '#0f1419'");
  expect(tokens).toContain("text: '#e7e9ea'");
  expect(tokens).toContain("primary: '#1d9bf0'");
  expect(tokens).toContain("border: '#eff3f4'");
  expect(tokens).toContain("border: '#2f3336'");
  expect(tokens).toContain('author: 15');
  expect(tokens).toContain('body: 15');
  expect(tokens).toContain('bodyLineHeight: 20');
  expect(tokens).toContain('metadata: 13');
  expect(tokens).toContain('feedHorizontal: 12');
});

test('home feed cards use the shared compact X-style author, body and metadata scale', () => {
  const start = feedItem.indexOf('const feedCard = (');
  const end = feedItem.indexOf('\n    return (\n        <>', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const card = feedItem.slice(start, end);

  expect(feedItem).toContain("import { getXDesignColors, X_DESIGN_TOKENS } from '~/constants/x-design-tokens';");
  expect(card).toContain('paddingHorizontal: X_DESIGN_TOKENS.spacing.feedHorizontal');
  expect(card).toContain('borderBottomColor: palette.border');
  expect(card).toContain('X_DESIGN_TOKENS.typography.author');
  expect(card).toContain('X_DESIGN_TOKENS.typography.metadata');
  expect(card).toContain('X_DESIGN_TOKENS.typography.body');
  expect(card).toContain('X_DESIGN_TOKENS.typography.bodyLineHeight');
  expect(card).not.toContain('text-lg');
  expect(card).toContain('color: palette.text');
});

test('home timeline tabs and compose action use the shared X blue and neutral surface system', () => {
  expect(home).toContain("import { getXDesignColors, X_DESIGN_TOKENS } from '~/constants/x-design-tokens';");
  expect(home).toContain('const APP_PRIMARY_COLOR = X_DESIGN_TOKENS.colors.light.primary;');
  expect(home).toContain('activeColor={palette.text}');
  expect(home).toContain('borderBottomColor: palette.border');
  expect(home).toContain('backgroundColor: palette.surface');
  expect(home).toContain('height: 4, borderRadius: 2');
});

test('feed engagement controls use the shared muted palette and denser action typography', () => {
  expect(engagement).toContain("import { getXDesignColors } from '~/constants/x-design-tokens';");
  expect(engagement).toContain('const iconColor = palette.muted;');
  expect(engagement).toContain('text-[13px] leading-4');
  expect(engagement).toContain('justify-between mt-3');
  expect(engagement).toContain('style={{ minHeight: 36, minWidth: 36 }}');
});
