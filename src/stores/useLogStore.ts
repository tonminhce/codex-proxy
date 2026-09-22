import { create } from 'zustand';
import { RequestLogEntry, RequestLogFilter } from '../types/logs';

const INITIAL_LOGS: RequestLogEntry[] = [
  {
    id: 'req-01',
    timestamp: Date.now() - 1000 * 20,
    method: 'POST',
    path: '/v1/responses',
    clientModel: 'gpt-5.5',
    upstreamModel: 'gpt-5.5',
    routeKind: 'oauth',
    accountId: 'acc-1',
    accountEmail: 'alex.dev@openai.com',
    status: 200,
    durationMs: 1180,
    inputTokens: 1840,
    outputTokens: 420,
    cachedTokens: 1200,
    reasoningTokens: 128,
    totalTokens: 2260,
    estimatedCostUsd: 0.0072,
  },
  {
    id: 'req-02',
    timestamp: Date.now() - 1000 * 95,
    method: 'POST',
    path: '/v1/responses',
    clientModel: 'cpa/gpt-5.5',
    upstreamModel: 'gpt-5.5',
    routeKind: 'mixed_route',
    status: 200,
    durationMs: 890,
    inputTokens: 920,
    outputTokens: 280,
    cachedTokens: 400,
    reasoningTokens: 64,
    totalTokens: 1200,
    estimatedCostUsd: 0.0036,
  },
  {
    id: 'req-03',
    timestamp: Date.now() - 1000 * 180,
    method: 'POST',
    path: '/v1/chat/completions',
    clientModel: 'gpt-5.5',
    upstreamModel: 'gpt-5.5',
    routeKind: 'oauth',
    accountId: 'acc-1',
    accountEmail: 'alex.dev@openai.com',
    status: 200,
    durationMs: 1420,
    inputTokens: 3100,
    outputTokens: 650,
    cachedTokens: 2400,
    reasoningTokens: 256,
    totalTokens: 3750,
    estimatedCostUsd: 0.0124,
  },
  {
    id: 'req-04',
    timestamp: Date.now() - 1000 * 320,
    method: 'POST',
    path: '/v1/responses',
    clientModel: 'deepseek/deepseek-v4-flash',
    upstreamModel: 'deepseek-v4-flash',
    routeKind: 'mixed_route',
    status: 200,
    durationMs: 640,
    inputTokens: 2100,
    outputTokens: 520,
    cachedTokens: 1500,
    reasoningTokens: 0,
    totalTokens: 2620,
    estimatedCostUsd: 0.0011,
  },
  {
    id: 'req-05',
    timestamp: Date.now() - 1000 * 540,
    method: 'POST',
    path: '/v1/responses',
    clientModel: 'gpt-5.5',
    upstreamModel: 'gpt-5.5',
    routeKind: 'oauth',
    accountId: 'acc-2',
    accountEmail: 'team-pool-01@company.internal',
    status: 429,
    durationMs: 310,
    inputTokens: 540,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: 540,
    error: 'rate_limit_exceeded: Hourly usage cap reached. Auto-rotated to next account.',
  },
];

interface LogStore {
  logs: RequestLogEntry[];
  filter: RequestLogFilter;
  setFilter: (filter: Partial<RequestLogFilter>) => void;
  clearLogs: () => void;
  addLog: (entry: RequestLogEntry) => void;
}

export const useLogStore = create<LogStore>((set) => ({
  logs: INITIAL_LOGS,
  filter: { status: 'all' },

  setFilter: (newFilter) => {
    set((state) => ({ filter: { ...state.filter, ...newFilter } }));
  },

  clearLogs: () => {
    set({ logs: [] });
  },

  addLog: (entry) => {
    set((state) => ({ logs: [entry, ...state.logs.slice(0, 499)] }));
  },
}));
