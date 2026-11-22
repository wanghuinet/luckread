import { expect, test } from 'bun:test';
import { advanceTabBarScrollState } from '../lib/tab-bar-scroll-state';

const initialState = () => ({
  lastOffset: null,
  direction: 0,
  accumulatedDistance: 0,
});

const advance = (state, offset) =>
  advanceTabBarScrollState(state, offset);

test('hides only after accumulated downward movement reaches the threshold', () => {
  let state = initialState();
  state = advance(state, 100).state;
  let result = advance(state, 108);
  expect(result.visibility).toBeNull();
  state = result.state;

  result = advance(state, 117);
  expect(result.visibility).toBeNull();
  state = result.state;

  result = advance(state, 118);
  expect(result.visibility).toBe(false);
  expect(result.state.accumulatedDistance).toBe(0);
});

test('restores after accumulated upward movement reaches its lower threshold', () => {
  let state = initialState();
  state = advance(state, 100).state;
  state = advance(state, 118).state;

  let result = advance(state, 114);
  expect(result.visibility).toBeNull();
  state = result.state;

  result = advance(state, 107);
  expect(result.visibility).toBeNull();
  state = result.state;

  result = advance(state, 106);
  expect(result.visibility).toBe(true);
  expect(result.state.accumulatedDistance).toBe(0);
});

test('direction changes reset accumulated distance instead of combining opposite movement', () => {
  let state = initialState();
  state = advance(state, 100).state;
  state = advance(state, 110).state;
  const result = advance(state, 105);

  expect(result.visibility).toBeNull();
  expect(result.state.direction).toBe(-1);
  expect(result.state.accumulatedDistance).toBe(5);
});

test('returning to the top restores the tab bar and resets direction history', () => {
  let state = initialState();
  state = advance(state, 100).state;
  state = advance(state, 118).state;

  const result = advance(state, 16);
  expect(result.visibility).toBe(true);
  expect(result.state).toEqual({
    lastOffset: 16,
    direction: 0,
    accumulatedDistance: 0,
  });
});

test('ignores invalid offsets and sub-pixel jitter without corrupting scroll state', () => {
  const state = { lastOffset: 100, direction: 1, accumulatedDistance: 6 };
  expect(advance(state, Number.NaN)).toEqual({ state, visibility: null });

  const jitter = advance(state, 100.05);
  expect(jitter.visibility).toBeNull();
  expect(jitter.state).toEqual({
    lastOffset: 100.05,
    direction: 1,
    accumulatedDistance: 6,
  });
});
