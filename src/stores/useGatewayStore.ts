import { create } from 'zustand';
import { GatewayState, RoutingStrategy, GatewayScope, ClientApiKey } from '../types/gateway';

interface GatewayStore extends GatewayState {
  toggleGateway: () => Promise<void>;
  updatePort: (port: number) => void;
  updateScope: (scope: GatewayScope) => void;
  updateRoutingStrategy: (strategy: RoutingStrategy) => void;
  updateSessionAffinity: (enabled: boolean, ttlSeconds: number) => void;
  updateQuotaReserve: (percent: number) => void;
  createApiKey: (name: string) => void;
  deleteApiKey: (id: string) => void;
  toggleApiKey: (id: string) => void;
}

export const useGatewayStore = create<GatewayStore>((set) => ({
  running: true,
  port: 8080,
  host: '127.0.0.1',
  scope: 'localhost',
  routingStrategy: 'auto',
  sessionAffinity: true,
  sessionAffinityTtlSeconds: 1800,
  quotaReservePercent: 15,
  maxRetries: 3,
  apiKeys: [
    {
      id: 'key-1',
      name: 'Default Client Key',
      key: 'sk-codex-local-9a84f18d7bc2014e',
      enabled: true,
      totalTokensUsed: 148200,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 10,
    },
    {
      id: 'key-2',
      name: 'Cursor / Claude Code Agent Key',
      key: 'sk-codex-agent-4b7189ef01a239cd',
      enabled: true,
      totalTokensUsed: 382400,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    },
  ],
  stats: {
    totalRequests: 1420,
    successfulRequests: 1408,
    failedRequests: 12,
    totalTokens: 1294800,
    requestsPerSecond: 2.4,
  },

  toggleGateway: async () => {
    set((state) => ({ running: !state.running }));
  },

  updatePort: (port: number) => {
    set({ port });
  },

  updateScope: (scope: GatewayScope) => {
    set({
      scope,
      host: scope === 'lan' ? '0.0.0.0' : '127.0.0.1',
    });
  },

  updateRoutingStrategy: (routingStrategy: RoutingStrategy) => {
    set({ routingStrategy });
  },

  updateSessionAffinity: (sessionAffinity: boolean, sessionAffinityTtlSeconds: number) => {
    set({ sessionAffinity, sessionAffinityTtlSeconds });
  },

  updateQuotaReserve: (quotaReservePercent: number) => {
    set({ quotaReservePercent });
  },

  createApiKey: (name: string) => {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const newKey: ClientApiKey = {
      id: `key-${Date.now()}`,
      name: name || 'New Client API Key',
      key: `sk-codex-local-${randomHex}`,
      enabled: true,
      totalTokensUsed: 0,
      createdAt: Date.now(),
    };
    set((state) => ({ apiKeys: [...state.apiKeys, newKey] }));
  },

  deleteApiKey: (id: string) => {
    set((state) => ({ apiKeys: state.apiKeys.filter((k) => k.id !== id) }));
  },

  toggleApiKey: (id: string) => {
    set((state) => ({
      apiKeys: state.apiKeys.map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k)),
    }));
  },
}));
