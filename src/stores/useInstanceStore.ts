import { create } from 'zustand';
import { CodexInstance, ModelRoute } from '../types/instance';
import { action, backend } from '../lib/backend';
interface InstanceStore {
  instances: CodexInstance[];
  loadInstances: () => Promise<void>;
  createInstance: (name: string, path: string, boundAccountId?: string) => Promise<boolean>;
  toggleInstanceRunning: (id: string) => Promise<boolean>;
  deleteInstance: (id: string) => Promise<boolean>;
  addRoute: (id: string, route: Omit<ModelRoute, 'id'>) => Promise<boolean>;
  toggleRoute: (id: string, route: string) => Promise<boolean>;
  deleteRoute: (id: string, route: string) => Promise<boolean>;
}
let pending: Promise<unknown> = Promise.resolve();
export const useInstanceStore = create<InstanceStore>((set, get) => {
  const mutate = (work: () => Promise<void>) => {
    const next = pending.then(() => action(work)); pending = next; return next;
  };
  const save = async (instance: CodexInstance) => {
    const saved = await backend<CodexInstance>('save_codex_instance', { instance });
    set(s => ({ instances: [...s.instances.filter(i => i.id !== saved.id), saved] }));
  };
  const update = (id: string, change: (instance: CodexInstance) => CodexInstance) => mutate(async () => {
    const instance = get().instances.find(i => i.id === id);
    if (instance) await save(change(instance));
  });
  return {
    instances: [],
    loadInstances: async () => { try { set({ instances: await backend<CodexInstance[]>('list_codex_instances') }); } catch { /* visible error */ } },
    createInstance: (name, profilePath, boundAccountId) => mutate(() => save({
      id: '', name, profilePath, isRunning: false, boundAccountId, routes: [],
      mixedRoutingEnabled: false, createdAt: Date.now(),
    })),
    toggleInstanceRunning: instanceId => mutate(async () => {
      set({ instances: await backend<CodexInstance[]>('toggle_codex_instance', { instanceId }) });
    }),
    deleteInstance: instanceId => mutate(async () => {
      await backend('delete_codex_instance', { instanceId });
      set(s => ({ instances: s.instances.filter(i => i.id !== instanceId) }));
    }),
    addRoute: (id, route) => update(id, i => ({ ...i, routes: [...i.routes, { ...route, id: '' }] })),
    toggleRoute: (id, routeId) => update(id, i => ({ ...i, routes: i.routes.map(r => r.id === routeId ? { ...r, enabled: !r.enabled } : r) })),
    deleteRoute: (id, routeId) => update(id, i => ({ ...i, routes: i.routes.filter(r => r.id !== routeId) })),
  };
});
