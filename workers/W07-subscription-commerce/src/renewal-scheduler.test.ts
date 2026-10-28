import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runRenewalScheduledBatch, type RenewalScheduledDependencies } from './renewal-scheduler.js';
import type { RenewalRuntimeEnv } from './renewal-runtime.js';

const syncResult = { scanned: 0, applied: 0, reconciliationRequired: 0, pendingRetry: 0 };

function setup(missing: string[] = []) {
  const d1_01 = { marker: 'D1-01' } as unknown as D1Database;
  const d1_04 = { marker: 'D1-04' } as unknown as D1Database;
  const env: RenewalRuntimeEnv = { D1_01: d1_01, D1_04: d1_04, HYPERSWITCH_ENVIRONMENT: 'sandbox', HYPERSWITCH_API_KEY: 'test', HYPERSWITCH_MERCHANT_ID: 'merchant_test' };
  const readTableNames = vi.fn(async (db: D1Database, expected: readonly string[]) =>
    new Set(expected.filter((name) => !(db === d1_04 && missing.includes('D1-04.' + name)) &&
      !(db === d1_01 && missing.includes('D1-01.' + name))));
  const syncPending = vi.fn(async () => syncResult);
  const scanDue = vi.fn(async () => ({
    scanned: 2,
    cycleIds: ['rcy_' + 'a'.repeat(26), 'rcy_' + 'b'.repeat(26)],
    cursorAdvanced: true,
    cursorReset: false,
  }));
  const processCycle = vi.fn(async (_env: RenewalRuntimeEnv, cycleId: string) => ({
    cycleId,
    state: 'PREPARED' as const,
    action: 'PREPARED' as const,
  }));
  const dependencies: RenewalScheduledDependencies = { readTableNames, syncPending, scanDue, processCycle };
  return { env, dependencies, readTableNames, syncPending, scanDue, processCycle };
}

describe('W07 scheduled renewal batch', () => {
  it('fails closed without querying renewal state until all D1 schemas are admitted', async () => {
    const state = setup(['D1-04.subscription_renewal_cycles']);
    const result = await runRenewalScheduledBatch(state.env, state.dependencies);
    expect(result).toMatchObject({
      status: 'SCHEMA_NOT_READY',
      reason: 'REQUIRED_TABLES_MISSING',
      missingTables: ['D1-04.subscription_renewal_cycles'],
    });
    expect(state.syncPending).not.toHaveBeenCalled();
    expect(state.scanDue).not.toHaveBeenCalled();
    expect(state.processCycle).not.toHaveBeenCalled();
  });

  it('recovers pending outcomes before and after a bounded five-cycle scan', async () => {
    const state = setup();
    const result = await runRenewalScheduledBatch(state.env, state.dependencies);
    expect(result).toMatchObject({ status: 'COMPLETED', processed: 2, processFailures: 0 });
    expect(state.syncPending).toHaveBeenCalledTimes(2);
    expect(state.syncPending).toHaveBeenNthCalledWith(1, state.env, { limit: 10 });
    expect(state.syncPending).toHaveBeenNthCalledWith(2, state.env, { limit: 10 });
    expect(state.scanDue).toHaveBeenCalledWith(state.env, { limit: 5 });
    expect(state.processCycle).toHaveBeenCalledTimes(2);
  });

  it('does not start renewal scanning if pre-existing cross-D1 outcome recovery fails', async () => {
    const state = setup();
    state.syncPending.mockRejectedValueOnce(new Error('D1-01 unavailable'));
    const result = await runRenewalScheduledBatch(state.env, state.dependencies);
    expect(result).toEqual({ status: 'PARTIAL', phase: 'OUTCOME_SYNC_BEFORE' });
    expect(state.scanDue).not.toHaveBeenCalled();
    expect(state.processCycle).not.toHaveBeenCalled();
  });

  it('continues the bounded batch when one cycle fails without claiming the whole tick is complete', async () => {
    const state = setup();
    state.processCycle.mockRejectedValueOnce(new Error('provider timeout'));
    const result = await runRenewalScheduledBatch(state.env, state.dependencies);
    expect(result).toMatchObject({ status: 'PARTIAL', processed: 1, processFailures: 1 });
    expect(state.processCycle).toHaveBeenCalledTimes(2);
    expect(state.syncPending).toHaveBeenCalledTimes(2);
  });

  it('does not start a scan if the schema preflight itself fails', async () => {
    const state = setup();
    state.readTableNames.mockRejectedValueOnce(new Error('D1 unavailable'));
    const result = await runRenewalScheduledBatch(state.env, state.dependencies);
    expect(result).toMatchObject({ status: 'SCHEMA_NOT_READY', reason: 'SCHEMA_PROBE_FAILED' });
    expect(state.syncPending).not.toHaveBeenCalled();
    expect(state.scanDue).not.toHaveBeenCalled();
  });
});
