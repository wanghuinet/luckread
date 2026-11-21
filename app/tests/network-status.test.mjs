import { expect, test } from 'bun:test';

import { isNetworkOffline } from '../lib/network-state';

test('recognizes an explicitly disconnected device', () => {
  expect(isNetworkOffline({ isConnected: false })).toBe(true);
});

test('recognizes a connected network without internet reachability', () => {
  expect(isNetworkOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
});

test('does not report offline when connectivity and internet are available', () => {
  expect(isNetworkOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
});

test('does not show a false offline state while connectivity is unresolved', () => {
  expect(isNetworkOffline(undefined)).toBe(false);
  expect(isNetworkOffline(null)).toBe(false);
  expect(isNetworkOffline({})).toBe(false);
  expect(isNetworkOffline({ isConnected: true })).toBe(false);
});
