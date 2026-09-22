import { create } from 'zustand';
import { CodexInstance, ModelRoute } from '../types/instance';

interface InstanceStore {
  instances: CodexInstance[];
  createInstance: (name: string, profilePath: string) => void;
  toggleInstanceRunning: (id: string) => void;
  deleteInstance: (id: string) => void;
  addRoute: (instanceId: string, route: Omit<ModelRoute, 'id'>) => void;
  toggleRoute: (instanceId: string, routeId: string) => void;
  deleteRoute: (instanceId: string, routeId: string) => void;
}

const MOCK_INSTANCES: CodexInstance[] = [
  {
    id: 'inst-default',
    name: 'Primary Desktop Profile',
    profilePath: '~/.codex',
    isRunning: true,
    pid: 74218,
    boundAccountId: 'acc-1',
    mixedRoutingEnabled: true,
    routes: [
      {
        id: 'route-cpa',
        namespace: 'cpa',
        providerName: 'Custom CPA Relay',
        providerBaseUrl: 'https://cpa.example.com/v1',
        upstreamModel: 'gpt-5.5',
        enabled: true,
      },
      {
        id: 'route-deepseek',
        namespace: 'deepseek',
        providerName: 'DeepSeek Official',
        providerBaseUrl: 'https://api.deepseek.com/v1',
        upstreamModel: 'deepseek-v4-flash',
        enabled: true,
      },
    ],
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
    lastLaunchedAt: Date.now() - 1000 * 60 * 20,
  },
  {
    id: 'inst-2',
    name: 'Experiment Sandbox (Isolated Profile)',
    profilePath: '~/.codex-profiles/sandbox',
    isRunning: false,
    boundAccountId: 'acc-2',
    mixedRoutingEnabled: false,
    routes: [],
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
  },
];

export const useInstanceStore = create<InstanceStore>((set) => ({
  instances: MOCK_INSTANCES,

  createInstance: (name: string, profilePath: string) => {
    const newInst: CodexInstance = {
      id: `inst-${Date.now()}`,
      name,
      profilePath: profilePath || `~/.codex-profiles/${name.toLowerCase().replace(/\s+/g, '-')}`,
      isRunning: false,
      mixedRoutingEnabled: false,
      routes: [],
      createdAt: Date.now(),
    };
    set((state) => ({ instances: [...state.instances, newInst] }));
  },

  toggleInstanceRunning: (id: string) => {
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === id
          ? {
              ...inst,
              isRunning: !inst.isRunning,
              pid: !inst.isRunning ? Math.floor(Math.random() * 50000) + 10000 : undefined,
              lastLaunchedAt: !inst.isRunning ? Date.now() : inst.lastLaunchedAt,
            }
          : inst
      ),
    }));
  },

  deleteInstance: (id: string) => {
    set((state) => ({ instances: state.instances.filter((inst) => inst.id !== id) }));
  },

  addRoute: (instanceId: string, route: Omit<ModelRoute, 'id'>) => {
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? {
              ...inst,
              routes: [...inst.routes, { ...route, id: `route-${Date.now()}` }],
            }
          : inst
      ),
    }));
  },

  toggleRoute: (instanceId: string, routeId: string) => {
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? {
              ...inst,
              routes: inst.routes.map((r) => (r.id === routeId ? { ...r, enabled: !r.enabled } : r)),
            }
          : inst
      ),
    }));
  },

  deleteRoute: (instanceId: string, routeId: string) => {
    set((state) => ({
      instances: state.instances.map((inst) =>
        inst.id === instanceId
          ? {
              ...inst,
              routes: inst.routes.filter((r) => r.id !== routeId),
            }
          : inst
      ),
    }));
  },
}));
