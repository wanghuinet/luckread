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
  trialExpiry?: { scanned: number; expired: number };
  trialExpiryError?: boolean;
  expiryCalls?: { count: number };
  processCalls?: { count: number };
  events?: string[];
}>;

function dependencies(options: TestOptions = {}): RenewalScheduledDependencies {
  const recoveryResults = options.recoveryResults ?? [cleanRecovery, cleanRecovery];
  let recoveryCall = 0;

  return {
    readTableNames: async (_db, expected) => new Set(expected),
    syncPending: async () => {
      options.events?.push('sync');
      return recoveryResults[Math.min(recoveryCall++, recoveryResults.length - 1)];
    },
    expireTrials: async () => {
      options.events?.push('expire');
      if (options.expiryCalls) options.expiryCalls.count += 1;
      if (options.trialExpiryError) throw new Error('trial expiry unavailable');
      return options.trialExpiry ?? { scanned: 0, expired: 0 };
    },
    scanDue: async (): Promise<RenewalScanResult> => {
      options.events?.push('scan');
      if (options.scanCalls) options.scanCalls.count += 1;
      return {
        scanned: 1,
        cycleIds: ['rcy_' + 'a'.repeat(26)],
        cursorAdvanced: false,
        cursorReset: false,
      };
    },
    processCycle: async (_env, cycleId): Promise<RenewalProcessResult> => {
      options.events?.push('process');
      if (options.processCalls) options.processCalls.count += 1;
      return options.cycleResult ?? { cycleId, state: 'PREPARED', action: 'PREPARED' };
    },
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

  it('scans and processes the first trial renewal before running bounded trial expiry', async () => {
    const expiryCalls = { count: 0 };
    const events: string[] = [];
    const result = await runRenewalScheduledBatch(env, dependencies({
      expiryCalls,
      events,
      trialExpiry: { scanned: 3, expired: 2 },
    }));

    expect(result.status).toBe('COMPLETED');
    expect(expiryCalls.count).toBe(1);
    expect(events).toEqual(['sync', 'scan', 'process', 'sync', 'expire']);
    if ('trialExpiry' in result) {
      expect(result.trialExpiry).toEqual({ scanned: 3, expired: 2 });
    }
  });

  it('does not expire trial access when the first charge outcome remains unresolved', async () => {
    const expiryCalls = { count: 0 };
    const result = await runRenewalScheduledBatch(env, dependencies({
      expiryCalls,
      recoveryResults: [
        cleanRecovery,
        { scanned: 1, applied: 0, reconciliationRequired: 0, pendingRetry: 1 },
      ],
    }));

    expect(result.status).toBe('PARTIAL');
    expect(expiryCalls.count).toBe(0);
  });

  it('reports the trial expiry failure only after the first renewal cycle was scanned and processed', async () => {
    const scanCalls = { count: 0 };
    const processCalls = { count: 0 };
    const events: string[] = [];
    const result = await runRenewalScheduledBatch(env, dependencies({
      scanCalls,
      processCalls,
      events,
      trialExpiryError: true,
    }));

    expect(result).toMatchObject({
      status: 'PARTIAL',
      phase: 'TRIAL_EXPIRY',
      beforeRecovery: cleanRecovery,
    });
    expect(scanCalls.count).toBe(1);
    expect(processCalls.count).toBe(1);
    expect(events).toEqual(['sync', 'scan', 'process', 'sync', 'expire']);
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
