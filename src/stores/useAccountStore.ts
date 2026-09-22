import { create } from 'zustand';
import { CodexAccount, AddAccountPayload } from '../types/account';

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(cmd, args);
    }
  } catch (err) {
    console.warn(`Tauri command '${cmd}' error:`, err);
    throw err;
  }
  return null;
}

const INITIAL_FALLBACK_ACCOUNTS: CodexAccount[] = [
  {
    id: '81289c78-c10d-4dd5-9c51-e2499b7b0c8a',
    email: 'amadoudiawara863@gmail.com',
    name: 'Trương Kim Hoa',
    authMode: 'oauth',
    planType: 'plus',
    isActive: true,
    isCooldown: false,
    quota: {
      hourly: { usedPercent: 18, remainingPercent: 82, resetMinutesRemaining: 36 },
      weekly: { usedPercent: 12, remainingPercent: 88, resetMinutesRemaining: 3600 },
      lunaReserveAllowed: true,
      lunaReserveActive: false,
      resetCreditsRemaining: 5,
      updatedAt: Date.now(),
    },
    createdAt: Date.now() - 86400000 * 2,
    lastUsedAt: Date.now() - 60000 * 12,
  },
  {
    id: '6e4540dd-3a10-4cd5-9187-76dcac76940f',
    email: 'cedricdiscuss@gmail.com',
    name: 'Cedric Discuss',
    authMode: 'oauth',
    planType: 'plus',
    isActive: false,
    isCooldown: false,
    quota: {
      hourly: { usedPercent: 5, remainingPercent: 95, resetMinutesRemaining: 58 },
      weekly: { usedPercent: 8, remainingPercent: 92, resetMinutesRemaining: 8400 },
      lunaReserveAllowed: true,
      lunaReserveActive: false,
      resetCreditsRemaining: 5,
      updatedAt: Date.now(),
    },
    createdAt: Date.now() - 86400000 * 4,
    lastUsedAt: Date.now() - 3600000 * 3,
  },
];

interface AccountState {
  accounts: CodexAccount[];
  activeAccount: CodexAccount | null;
  loading: boolean;
  error: string | null;
  loadAccounts: () => Promise<void>;
  switchActiveAccount: (accountId: string) => Promise<void>;
  refreshAccountQuota: (accountId: string) => Promise<void>;
  deleteAccount: (accountId: string) => Promise<void>;
  addAccount: (payload: AddAccountPayload) => Promise<void>;
  importFromJson: (jsonContent: string) => Promise<CodexAccount[]>;
  startOAuthLogin: () => Promise<CodexAccount>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: INITIAL_FALLBACK_ACCOUNTS,
  activeAccount: INITIAL_FALLBACK_ACCOUNTS[0],
  loading: false,
  error: null,

  startOAuthLogin: async (): Promise<CodexAccount> => {
    set({ loading: true, error: null });
    try {
      const account = await invokeTauri<CodexAccount>('start_oauth_login');
      if (account) {
        await get().loadAccounts();
        set({ loading: false });
        return account;
      }
    } catch (err: any) {
      set({ loading: false, error: err?.message || err?.toString() || 'OAuth login failed' });
      throw err;
    }
    throw new Error('OAuth login returned no account data');
  },

  loadAccounts: async () => {
    set({ loading: true, error: null });
    try {
      const tauriAccounts = await invokeTauri<CodexAccount[]>('list_codex_accounts');
      if (tauriAccounts && tauriAccounts.length > 0) {
        const active = tauriAccounts.find((a) => a.isActive) || tauriAccounts[0] || null;
        set({ accounts: tauriAccounts, activeAccount: active, loading: false });
        return;
      }
    } catch (e: any) {
      console.error('Failed to load accounts from Tauri:', e);
    }
    const current = get().accounts;
    set({ loading: false, activeAccount: current.find((a) => a.isActive) || current[0] || null });
  },

  switchActiveAccount: async (accountId: string) => {
    set({ loading: true, error: null });
    try {
      const switched = await invokeTauri<CodexAccount>('switch_codex_account', { accountId });
      if (switched) {
        set((state) => ({
          accounts: state.accounts.map((a) => ({
            ...a,
            isActive: a.id === accountId,
          })),
          activeAccount: switched,
          loading: false,
        }));
        return;
      }
    } catch (e: any) {
      console.warn('Switch in Tauri backend failed, applying in store:', e);
    }

    set((state) => {
      const updated = state.accounts.map((acc) => ({
        ...acc,
        isActive: acc.id === accountId,
      }));
      return {
        accounts: updated,
        activeAccount: updated.find((a) => a.id === accountId) || null,
        loading: false,
      };
    });
  },

  refreshAccountQuota: async (accountId: string) => {
    try {
      const updatedAcc = await invokeTauri<CodexAccount>('refresh_codex_quota', { accountId });
      if (updatedAcc) {
        set((state) => ({
          accounts: state.accounts.map((a) => (a.id === accountId ? updatedAcc : a)),
          activeAccount: state.activeAccount?.id === accountId ? updatedAcc : state.activeAccount,
        }));
        return;
      }
    } catch (e: any) {
      console.warn('Live quota query error:', e);
    }

    set((state) => ({
      accounts: state.accounts.map((acc) =>
        acc.id === accountId
          ? {
              ...acc,
              quota: {
                ...acc.quota,
                updatedAt: Date.now(),
              },
            }
          : acc
      ),
    }));
  },

  deleteAccount: async (accountId: string) => {
    try {
      await invokeTauri('delete_codex_account', { accountId });
    } catch (e) {
      console.warn('Delete in Tauri failed, continuing locally:', e);
    }
    set((state) => {
      const updated = state.accounts.filter((a) => a.id !== accountId);
      return {
        accounts: updated,
        activeAccount: state.activeAccount?.id === accountId ? updated[0] || null : state.activeAccount,
      };
    });
  },

  addAccount: async (payload: AddAccountPayload) => {
    const newAccount: CodexAccount = {
      id: `acc-${Date.now()}`,
      email: payload.email || `${payload.name || 'custom'}@codex.account`,
      name: payload.name || 'New Codex Account',
      authMode: payload.authMode,
      planType: 'plus',
      isActive: false,
      isCooldown: false,
      quota: {
        hourly: { usedPercent: 0, remainingPercent: 100, resetMinutesRemaining: 60 },
        weekly: { usedPercent: 0, remainingPercent: 100, resetMinutesRemaining: 10080 },
        lunaReserveAllowed: false,
        lunaReserveActive: false,
        resetCreditsRemaining: 0,
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
      apiBaseUrl: payload.apiBaseUrl,
    };

    try {
      await invokeTauri('add_codex_account', { account: newAccount });
    } catch (e) {
      console.warn('Add in Tauri failed, saving to local store:', e);
    }

    set((state) => ({
      accounts: [...state.accounts, newAccount],
    }));
  },

  importFromJson: async (jsonContent: string): Promise<CodexAccount[]> => {
    set({ loading: true, error: null });
    try {
      const result = await invokeTauri<CodexAccount[]>('import_codex_from_json', { jsonContent });
      if (result && result.length > 0) {
        await get().loadAccounts();
        set({ loading: false });
        return result;
      }
    } catch (e: any) {
      set({ loading: false, error: e?.toString() || 'Failed to import JSON' });
      throw e;
    }

    // Fallback simulation if running in pure browser Vite dev
    const parsed = JSON.parse(jsonContent);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const imported: CodexAccount[] = items.map((item, idx) => ({
      id: item.account_id || `acc-imported-${Date.now()}-${idx}`,
      email: item.email || 'imported@chatgpt.com',
      name: item.name || `Imported Codex (${item.plan_type || 'plus'})`,
      authMode: 'oauth',
      planType: item.plan_type || 'plus',
      isActive: idx === 0,
      isCooldown: false,
      quota: {
        hourly: { usedPercent: 10, remainingPercent: 90, resetMinutesRemaining: 45 },
        weekly: { usedPercent: 5, remainingPercent: 95, resetMinutesRemaining: 3900 },
        lunaReserveAllowed: true,
        lunaReserveActive: false,
        resetCreditsRemaining: 5,
        updatedAt: Date.now(),
      },
      createdAt: Date.now(),
    }));

    set((state) => {
      const merged = [...state.accounts.filter((a) => a.id !== 'acc-1'), ...imported];
      return {
        accounts: merged,
        activeAccount: merged.find((a) => a.isActive) || merged[0] || null,
        loading: false,
      };
    });

    return imported;
  },
}));
