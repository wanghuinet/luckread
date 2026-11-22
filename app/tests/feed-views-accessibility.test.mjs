import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const actions = readFileSync(new URL('../components/EngagementActions.tsx', import.meta.url), 'utf8');

test('feed view count is announced as static content, not an inert button', () => {
  const viewsIndex = actions.indexOf('<Views');
  expect(viewsIndex).toBeGreaterThan(-1);

  const blockStart = actions.lastIndexOf('<View', viewsIndex);
  const blockEnd = actions.indexOf('</View>', viewsIndex);
  expect(blockStart).toBeGreaterThan(-1);
  expect(blockEnd).toBeGreaterThan(viewsIndex);

  const viewsCounter = actions.slice(blockStart, blockEnd);
  expect(viewsCounter).toContain('<View className="flex-row items-center gap-1.5">');
  expect(viewsCounter).toContain('<Text className={textColor}>{itemData?.view_count}</Text>');
  expect(viewsCounter).not.toContain('TouchableOpacity');
  expect(viewsCounter).not.toContain('onPress');
});
