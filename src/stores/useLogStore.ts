import { create } from 'zustand';
import { RequestLogEntry, RequestLogFilter } from '../types/logs';
import { action, backend } from '../lib/backend';
interface LogStore {
  logs: RequestLogEntry[]; filter: RequestLogFilter;
  loadLogs: () => Promise<void>;
  setFilter: (filter: Partial<RequestLogFilter>) => void;
  clearLogs: () => Promise<boolean>;
}
let revision = 0;
export const useLogStore = create<LogStore>(set => ({
  logs: [], filter: { status: 'all' },
  loadLogs: async () => {
    const current = revision;
    try { const logs = await backend<RequestLogEntry[]>('list_request_logs'); if (current === revision) set({ logs }); } catch { /* visible global error */ }
  },
  setFilter: filter => set(state => ({ filter: { ...state.filter, ...filter } })),
  clearLogs: () => action(async () => { await backend('clear_request_logs'); revision++; set({ logs: [] }); }),
}));
