import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/LikeButton.tsx', import.meta.url), 'utf8');

test('like animation schedules cancellable timers and cleans them up on effect changes/unmount', () => {
  expect(source).toContain('animationTimersRef.current.forEach(clearTimeout)');
  expect(source).toContain('const scheduleAnimationTimer = (callback: () => void, delay: number)');
  expect(source).toContain('return () => {');
  expect(source).toContain('animationTimersRef.current = [];');
  expect(source).not.toContain('setTimeout(() => setShowConfetti(false), 140)');
});
