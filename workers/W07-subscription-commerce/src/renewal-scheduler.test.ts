import { describe, expect, it } from 'vitest';
import {
  runRenewalScheduledBatch,
  type RenewalScheduledDependencies,
} from './renewal-scheduler.js';
import type {
  RenewalProcessResult,
  RenewalRuntimeEnv,
  RenewalScanResult,
} from './renewal-runtime.js';

const database = {} as D1Database;
const env = { D1_01: database, D1_04: database } as RenewalRuntimeEnv;

const cleanRecovery = {
  scanned: 0,
  applied: 0,
  reconciliationRequired: 0,
  pendingRetry: 0,
};

type TestOptions = Readonly<{
  recoveryResults?: Array<typeof cleanRecovery>;
  cycleResult?: RenewalProcessResult;
}>;

function dependencies(options: TestOptions = {}): RenewalScheduledDependencies {
  const recoveryResults = options.recoveryResults ?? [cleanRecovery, cleanRecovery];
  let recoveryCall = 0;

  return {
    readTableNames: async (_db, expected) => new Set(expected),
    syncPending: async () => recoveryResults[Math.min(recoveryCall++, recoveryResults.length - 1)],
    scanDue: async (): Promise<RenewalScanResult> => ({
      scanned: 1,
      cycleIds: ['rcy_' + 'a'.repeat(26)],
      cursorAdvanced: false,
      cursorReset: false,
    }),
    processCycle: async (_env, cycleId): Promise<RenewalProcessResult> =>
      options.cycleResult ?? { cycleId, state: 'PREPARED', action: 'PREPARED' },
  };
}

describe('W07 renewal scheduler completion status', () => {
  it('reports COMPLETED when processing and both outcome-sync passes are clear', async () => {
    const result = await runRenewalScheduledBatch(env, dependencies());

    expect(result.status).toBe('COMPLETED');
    if (result.status === 'COMPLETED' || result.status === 'PARTIAL') {
      expect(result.processFailures).toBe(0);
      expect(result.afterRecovery?.reconciliationRequired).toBe(0);
      expect(result.afterRecovery?.pendingRetry).toBe(0);
    }
  });

  it('reports PARTIAL when the pre-scan pass requires reconciliation even if the second pass is clear', async () => {
    const result = await runRenewalScheduledBatch(env, dependencies({
      recoveryResults: [
        { scanned: 1, applied: 0, reconciliationRequired: 1, pendingRetry: 0 },
        cleanRecovery,
      ],
    }));

    expect(result.status).toBe('PARTIAL');
  });

  it('reports PARTIAL when a processed cycle is already in reconciliation state', async () => {
    const result = await runRenewalScheduledBatch(env, dependencies({
      cycleResult: {
        cycleId: 'rcy_' + 'a'.repeat(26),
        state: 'RECONCILIATION_REQUIRED',
        action: 'TERMINAL',
      },
    }));

    expect(result.status).toBe('PARTIAL');
  });

  it('reports PARTIAL when the post-scan outcome-sync pass still has retryable work', async () => {
    const result = await runRenewalScheduledBatch(env, dependencies({
      recoveryResults: [
        cleanRecovery,
        { scanned: 1, applied: 0, reconciliationRequired: 0, pendingRetry: 1 },
      ],
    }));

    expect(result.status).toBe('PARTIAL');
  });
});
