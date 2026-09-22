import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useAccountStore } from './useAccountStore';
import { useGatewayStore } from './useGatewayStore';
import { useLogStore } from './useLogStore';
import { useWakeupStore } from './useWakeupStore';
import { useInstanceStore } from './useInstanceStore';
import { useBackendError } from '../lib/backend';
import type { CodexAccount } from '../types/account';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const account: CodexAccount = {
  id: 'synthetic', email: 'test@example.invalid', authMode: 'oauth', planType: 'unknown',
  isActive: true, isCooldown: false, createdAt: 0,
  quota: { hourly: { usedPercent: 0, remainingPercent: 0 }, weekly: { usedPercent: 0, remainingPercent: 0 },
    lunaReserveAllowed: false, lunaReserveActive: false, resetCreditsRemaining: 0, updatedAt: 0 },
};
beforeEach(() => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  ipc.mockReset(); useBackendError.getState().clear();
  useAccountStore.setState({ accounts: [], activeAccount: null });
  useGatewayStore.setState({ apiKeys: [], running: false, busy: false });
  useLogStore.setState({ logs: [] }); useWakeupStore.setState({ tasks: [], runningTaskId: null });
  useInstanceStore.setState({ instances: [] });
});
describe('backend-owned UI state', () => {
  it('starts without demonstration accounts, logs, tasks, keys or processes', () => {
    expect(useAccountStore.getState().accounts).toEqual([]);
    expect(useLogStore.getState().logs).toEqual([]);
    expect(useInstanceStore.getState().instances).toEqual([]);
    expect(useWakeupStore.getState().tasks).toEqual([]);
  });
  it('honors an empty backend account list after deleting the last account', async () => {
    useAccountStore.setState({ accounts: [account], activeAccount: account });
    ipc.mockResolvedValue([]);
    await useAccountStore.getState().loadAccounts();
    expect(useAccountStore.getState().accounts).toEqual([]);
    expect(useAccountStore.getState().activeAccount).toBeNull();
  });
  it('does not apply failed switches or deletions locally', async () => {
    useAccountStore.setState({ accounts: [account], activeAccount: account });
    ipc.mockRejectedValue('disk unavailable');
    expect(await useAccountStore.getState().switchActiveAccount('other')).toBe(false);
    expect(await useAccountStore.getState().deleteAccount(account.id)).toBe(false);
    expect(useAccountStore.getState().activeAccount?.id).toBe(account.id);
    expect(useAccountStore.getState().accounts).toHaveLength(1);
    expect(useBackendError.getState().error).toBe('disk unavailable');
  });
  it('passes an API key to Rust without retaining it in the account store', async () => {
    ipc.mockImplementation(async command => command === 'list_codex_accounts' ? [account] : [account]);
    expect(await useAccountStore.getState().addAccount({ authMode: 'apikey', apiKey: 'synthetic-secret', apiBaseUrl: 'https://api.openai.com/v1' })).toBe(true);
    const args = ipc.mock.calls[0][1] as { jsonContent: string };
    expect(JSON.parse(args.jsonContent).apiKey).toBe('synthetic-secret');
    expect(JSON.stringify(useAccountStore.getState().accounts)).not.toContain('synthetic-secret');
  });
  it('never fakes a successful gateway start when the port is occupied', async () => {
    ipc.mockRejectedValue('port in use');
    expect(await useGatewayStore.getState().toggleGateway()).toBe(false);
    expect(useGatewayStore.getState().running).toBe(false);
    expect(useGatewayStore.getState().busy).toBe(false);
  });
  it('serializes configuration edits without losing earlier changes', async () => {
    ipc.mockImplementation(async (_command, args) => (args as { config: unknown }).config);
    const gateway = useGatewayStore.getState();
    await Promise.all([gateway.updatePort(9001), gateway.updateQuotaReserve(20)]);
    expect(useGatewayStore.getState().port).toBe(9001);
    expect(useGatewayStore.getState().quotaReservePercent).toBe(20);
    const last = ipc.mock.calls[1][1] as { config: { port: number } };
    expect(last.config.port).toBe(9001);
  });
  it('never creates a fake PID or task success after backend failure', async () => {
    ipc.mockRejectedValue('backend failed');
    expect(await useInstanceStore.getState().toggleInstanceRunning('missing')).toBe(false);
    expect(await useWakeupStore.getState().runTaskNow('missing')).toBe(false);
    expect(useInstanceStore.getState().instances).toEqual([]);
    expect(useWakeupStore.getState().runningTaskId).toBeNull();
    expect(useWakeupStore.getState().tasks).toEqual([]);
  });
  it('browser preview mutations fail visibly without simulating state', async () => {
    vi.stubGlobal('window', {});
    expect(await useGatewayStore.getState().toggleGateway()).toBe(false);
    expect(ipc).not.toHaveBeenCalled();
    expect(useBackendError.getState().error).toContain('Desktop backend unavailable');
  });
});
