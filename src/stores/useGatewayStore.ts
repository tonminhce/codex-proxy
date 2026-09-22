import { create } from 'zustand';
import { GatewayState, RoutingStrategy, GatewayScope, ClientApiKey } from '../types/gateway';
import { action, backend } from '../lib/backend';

type Config = Omit<GatewayState, 'stats' | 'activeUpstreamAccountId'>;
interface GatewayStore extends GatewayState {
  busy: boolean;
  loadGateway: () => Promise<void>;
  toggleGateway: () => Promise<boolean>;
  updatePort: (port: number) => Promise<boolean>;
  updateScope: (scope: GatewayScope) => Promise<boolean>;
  updateRoutingStrategy: (strategy: RoutingStrategy) => Promise<boolean>;
  updateSessionAffinity: (enabled: boolean, ttl: number) => Promise<boolean>;
  updateQuotaReserve: (percent: number) => Promise<boolean>;
  updateLimits: (limits: Partial<Pick<Config, 'requestTimeoutSeconds' | 'maxRetries' | 'requestsPerMinute'>>) => Promise<boolean>;
  createApiKey: (name: string) => Promise<boolean>;
  deleteApiKey: (id: string) => Promise<boolean>;
  toggleApiKey: (id: string) => Promise<boolean>;
}
let mutations: Promise<unknown> = Promise.resolve();
export const useGatewayStore = create<GatewayStore>((set, get) => {
  const update = (patch: (state: GatewayStore) => Partial<Config>) => {
    const result = mutations.then(() => action(async () => {
      set({ busy: true });
      try {
        const s = get();
        const config: Config = {
          running: s.running, port: s.port, host: s.host, scope: s.scope,
          routingStrategy: s.routingStrategy, sessionAffinity: s.sessionAffinity,
          sessionAffinityTtlSeconds: s.sessionAffinityTtlSeconds, quotaReservePercent: s.quotaReservePercent,
          apiKeys: s.apiKeys, maxRetries: s.maxRetries, requestTimeoutSeconds: s.requestTimeoutSeconds,
          requestsPerMinute: s.requestsPerMinute, ...patch(s),
        };
        set(await backend<Config>('update_gateway_config', { config }));
      } finally { set({ busy: false }); }
    }));
    mutations = result; return result;
  };
  return {
    busy: false, running: false, port: 8080, host: '127.0.0.1', scope: 'localhost',
    routingStrategy: 'auto', sessionAffinity: true, sessionAffinityTtlSeconds: 1800,
    quotaReservePercent: 15, maxRetries: 2, requestTimeoutSeconds: 300, requestsPerMinute: 0, apiKeys: [],
    stats: { totalRequests: 0, successfulRequests: 0, failedRequests: 0, totalTokens: 0, requestsPerSecond: 0 },
    loadGateway: async () => {
      if (get().busy) return;
      try {
        const [config, stats] = await Promise.all([backend<Config>('get_gateway_config'), backend<GatewayState['stats']>('get_gateway_stats')]);
        if (!get().busy) set({ ...config, stats });
      } catch { /* surfaced by backend */ }
    },
    toggleGateway: () => {
      const result = mutations.then(() => action(async () => {
        set({ busy: true });
        try { set(await backend<Config>('toggle_gateway')); }
        finally { set({ busy: false }); }
      }));
      mutations = result; return result;
    },
    updatePort: port => update(() => ({ port })),
    updateScope: scope => update(() => ({ scope, host: scope === 'lan' ? '0.0.0.0' : '127.0.0.1' })),
    updateRoutingStrategy: routingStrategy => update(() => ({ routingStrategy })),
    updateSessionAffinity: (sessionAffinity, sessionAffinityTtlSeconds) => update(() => ({ sessionAffinity, sessionAffinityTtlSeconds })),
    updateQuotaReserve: quotaReservePercent => update(() => ({ quotaReservePercent })),
    updateLimits: limits => update(() => limits),
    createApiKey: name => update(state => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const key: ClientApiKey = {
        id: crypto.randomUUID(), name: name.trim(), key: 'sk-codex-local-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
        enabled: true, totalTokensUsed: 0, createdAt: Date.now(),
      };
      return { apiKeys: [...state.apiKeys, key] };
    }),
    deleteApiKey: id => update(state => ({ apiKeys: state.apiKeys.filter(k => k.id !== id) })),
    toggleApiKey: id => update(state => ({ apiKeys: state.apiKeys.map(k => k.id === id ? { ...k, enabled: !k.enabled } : k) })),
  };
});
