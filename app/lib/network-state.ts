export type NetworkStateSnapshot = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

/**
 * Treat only an explicit disconnected/unreachable result as offline.
 * Unknown or not-yet-resolved state must not cause a false offline warning.
 */
export function isNetworkOffline(
  state: NetworkStateSnapshot | null | undefined,
): boolean {
  return state?.isConnected === false || state?.isInternetReachable === false;
}
