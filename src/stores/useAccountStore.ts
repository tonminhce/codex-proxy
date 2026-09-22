import { create } from 'zustand';
import { CodexAccount, AddAccountPayload } from '../types/account';
import { action, backend } from '../lib/backend';

interface AccountState {
  accounts: CodexAccount[]; activeAccount: CodexAccount | null; loading: boolean; error: string | null;
  loadAccounts: () => Promise<void>;
  switchActiveAccount: (id: string) => Promise<boolean>;
  refreshAccountQuota: (id: string) => Promise<boolean>;
  deleteAccount: (id: string) => Promise<boolean>;
  addAccount: (payload: AddAccountPayload) => Promise<boolean>;
  importFromJson: (json: string) => Promise<CodexAccount[]>;
  startOAuthLogin: () => Promise<CodexAccount>;
}
export const useAccountStore = create<AccountState>((set, get) => {
  const refresh = async () => {
    const accounts = await backend<CodexAccount[]>('list_codex_accounts');
    set({ accounts, activeAccount: accounts.find(a => a.isActive) || null });
  };
  return {
    accounts: [], activeAccount: null, loading: false, error: null,
    loadAccounts: async () => {
      set({ loading: true });
      try { await refresh(); set({ error: null }); }
      catch (e) { set({ error: String(e) }); }
      finally { set({ loading: false }); }
    },
    switchActiveAccount: id => action(async () => {
      await backend('switch_codex_account', { accountId: id }); await refresh();
    }),
    refreshAccountQuota: id => action(async () => {
      const account = await backend<CodexAccount>('refresh_codex_quota', { accountId: id });
      set(state => ({
        accounts: state.accounts.map(a => a.id === id ? account : a),
        activeAccount: state.activeAccount?.id === id ? account : state.activeAccount,
      }));
    }),
    deleteAccount: id => action(async () => {
      await backend('delete_codex_account', { accountId: id }); await refresh();
    }),
    addAccount: payload => action(async () => {
      await get().importFromJson(JSON.stringify({
        authMode: payload.authMode, email: payload.email, name: payload.name,
        apiKey: payload.apiKey, access_token: payload.accessToken,
        refresh_token: payload.refreshToken, apiBaseUrl: payload.apiBaseUrl,
      }));
    }),
    importFromJson: async jsonContent => {
      set({ loading: true, error: null });
      try {
        const accounts = await backend<CodexAccount[]>('import_codex_from_json', { jsonContent });
        await refresh(); return accounts;
      } catch (e) { set({ error: String(e) }); throw e; }
      finally { set({ loading: false }); }
    },
    startOAuthLogin: async () => {
      set({ loading: true, error: null });
      try {
        const account = await backend<CodexAccount>('start_oauth_login');
        await refresh(); return account;
      } catch (e) { set({ error: String(e) }); throw e; }
      finally { set({ loading: false }); }
    },
  };
});
