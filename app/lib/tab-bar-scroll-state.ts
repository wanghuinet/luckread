export type TabBarScrollDirection = 1 | -1 | 0;

export type TabBarScrollState = {
  lastOffset: number | null;
  direction: TabBarScrollDirection;
  accumulatedDistance: number;
};

export const HIDE_SCROLL_THRESHOLD = 18;
export const SHOW_SCROLL_THRESHOLD = 12;
export const TOP_RESET_OFFSET = 16;

export function advanceTabBarScrollState(
  state: TabBarScrollState,
  offset: number,
): { state: TabBarScrollState; visibility: boolean | null } {
  'worklet';

  if (!Number.isFinite(offset)) return { state, visibility: null };

  if (offset <= TOP_RESET_OFFSET) {
    return {
      state: { lastOffset: offset, direction: 0, accumulatedDistance: 0 },
      visibility: true,
    };
  }

  if (state.lastOffset === null) {
    return {
      state: { ...state, lastOffset: offset },
      visibility: null,
    };
  }

  const delta = offset - state.lastOffset;
  const nextState: TabBarScrollState = { ...state, lastOffset: offset };
  if (Math.abs(delta) < 0.1) return { state: nextState, visibility: null };

  const direction: TabBarScrollDirection = delta > 0 ? 1 : -1;
  if (direction !== state.direction) {
    nextState.direction = direction;
    nextState.accumulatedDistance = 0;
  }

  nextState.accumulatedDistance += Math.abs(delta);
  const threshold = direction > 0 ? HIDE_SCROLL_THRESHOLD : SHOW_SCROLL_THRESHOLD;
  if (nextState.accumulatedDistance < threshold) {
    return { state: nextState, visibility: null };
  }

  nextState.accumulatedDistance = 0;
  return { state: nextState, visibility: direction < 0 };
}
