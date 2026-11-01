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
  scanCalls?: { count: number };
}>;

function dependencies(options: TestOptions = {}): RenewalScheduledDependencies {
  const recoveryResults = options.recoveryResults ?? [cleanRecovery, cleanRecovery];
  let recoveryCall = 0;

  return {
    readTableNames: async (_db, expected) => new Set(expected),
    syncPending: async () => recoveryResults[Math.min(recoveryCall++, recoveryResults.length - 1)],
    scanDue: async (): Promise<RenewalScanResult> => {
      if (options.scanCalls) options.scanCalls.count += 1;
      return {
        scanned: 1,
        cycleIds: ['rcy_' + 'a'.repeat(26)],
        cursorAdvanced: false,
        cursorReset: false,
      };
    },
    processCycle: async (_env, cycleId): Promise<RenewalProcessResult> =>
      options.cycleResult ?? { cycleId, state: 'PREPARED', action: 'PREPARED' },
  };
}

describe('W07 renewal scheduler completion status', () => {
  it('reports COMPLETED when processing and both outcome-sync passes are clear', async () => {
    const result = await runRenewalScheduledBatch(env, dependencies());

    expect(result.status).toBe('COMPLETED');
    if ('afterRecovery' in result) {
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

  it('does not scan or initiate new provider work when pre-scan recovery has a retryable outcome', async () => {
    const scanCalls = { count: 0 };
    const result = await runRenewalScheduledBatch(env, dependencies({
      scanCalls,
      recoveryResults: [
        { scanned: 1, applied: 0, reconciliationRequired: 0, pendingRetry: 1 },
        cleanRecovery,
      ],
    }));

    expect(result).toMatchObject({
      status: 'PARTIAL',
      phase: 'OUTCOME_SYNC_BEFORE',
      beforeRecovery: { pendingRetry: 1 },
    });
    expect(scanCalls.count).toBe(0);
  });

  it('does not scan when pre-scan recovery identifies a reconciliation conflict', async () => {
    const scanCalls = { count: 0 };
    const result = await runRenewalScheduledBatch(env, dependencies({
      scanCalls,
      recoveryResults: [
        { scanned: 1, applied: 0, reconciliationRequired: 1, pendingRetry: 0 },
        cleanRecovery,
      ],
    }));

    expect(result).toMatchObject({
      status: 'PARTIAL',
      phase: 'OUTCOME_SYNC_BEFORE',
      beforeRecovery: { reconciliationRequired: 1 },
    });
    expect(scanCalls.count).toBe(0);
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


  it('supports a one-cycle cap for a durable W10 Workflow invocation', async () => {
    const processed: string[] = []
    let scanLimit = 0
    const cycleA = 'rcy_' + 'a'.repeat(26)
    const cycleB = 'rcy_' + 'b'.repeat(26)
    const deps: RenewalScheduledDependencies = {
      readTableNames: async (_db, expected) => new Set(expected),
      syncPending: async () => cleanRecovery,
      scanDue: async (_runtimeEnv, options): Promise<RenewalScanResult> => {
        scanLimit = options?.limit ?? 0
        return { scanned: 2, cycleIds: [cycleA, cycleB], cursorAdvanced: true, cursorReset: false }
      },
      processCycle: async (_runtimeEnv, cycleId): Promise<RenewalProcessResult> => {
        processed.push(cycleId)
        return { cycleId, state: 'PREPARED', action: 'PREPARED' }
      },
      maxCyclesPerBatch: 1,
    }

    const result = await runRenewalScheduledBatch(env, deps)

    expect(result.status).toBe('COMPLETED')
    expect(scanLimit).toBe(1)
    expect(processed).toEqual([cycleA])
  })

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
