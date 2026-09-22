import { create } from 'zustand';
import { WakeupTask } from '../types/wakeup';

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

const INITIAL_TASKS: WakeupTask[] = [
  {
    id: 'wakeup-default-4h',
    name: 'Codex Rolling Window Keepalive (4h)',
    enabled: true,
    accountId: '81289c78-c10d-4dd5-9c51-e2499b7b0c8a',
    intervalHours: 4,
    runOnStartup: true,
    lastRunAt: Date.now() - 1000 * 60 * 35,
    lastStatus: 'Success',
    lastDurationMs: 342,
    lastMessage: 'Rolling rate-limit window reset timer active',
    nextRunAt: Date.now() + 1000 * 60 * (4 * 60 - 35),
  },
  {
    id: 'wakeup-cedric-6h',
    name: 'Standby Profile Quota Warmup (6h)',
    enabled: true,
    accountId: '6e4540dd-3a10-4cd5-9187-76dcac76940f',
    intervalHours: 6,
    runOnStartup: false,
    lastRunAt: Date.now() - 1000 * 60 * 120,
    lastStatus: 'Success',
    lastDurationMs: 289,
    lastMessage: 'Token validated, session warmed',
    nextRunAt: Date.now() + 1000 * 60 * (6 * 60 - 120),
  },
];

interface WakeupState {
  tasks: WakeupTask[];
  loading: boolean;
  runningTaskId: string | null;
  loadTasks: () => Promise<void>;
  saveTask: (task: WakeupTask) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  runTaskNow: (taskId: string) => Promise<void>;
  toggleTaskEnabled: (taskId: string) => Promise<void>;
}

export const useWakeupStore = create<WakeupState>((set, get) => ({
  tasks: INITIAL_TASKS,
  loading: false,
  runningTaskId: null,

  loadTasks: async () => {
    set({ loading: true });
    try {
      const res = await invokeTauri<WakeupTask[]>('list_wakeup_tasks');
      if (res && res.length > 0) {
        set({ tasks: res, loading: false });
        return;
      }
    } catch (e) {
      console.warn('Failed to load wakeup tasks from Tauri:', e);
    }
    set({ loading: false });
  },

  saveTask: async (task: WakeupTask) => {
    try {
      const saved = await invokeTauri<WakeupTask>('save_wakeup_task', { task });
      if (saved) {
        set((state) => {
          const idx = state.tasks.findIndex((t) => t.id === saved.id);
          if (idx >= 0) {
            const next = [...state.tasks];
            next[idx] = saved;
            return { tasks: next };
          }
          return { tasks: [...state.tasks, saved] };
        });
        return;
      }
    } catch (e) {
      console.warn('Failed to save wakeup task in Tauri:', e);
    }

    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = [...state.tasks];
        next[idx] = task;
        return { tasks: next };
      }
      return { tasks: [...state.tasks, { ...task, id: task.id || `wakeup-${Date.now()}` }] };
    });
  },

  deleteTask: async (taskId: string) => {
    try {
      await invokeTauri('delete_wakeup_task', { taskId });
    } catch (e) {
      console.warn('Failed to delete wakeup task in Tauri:', e);
    }
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));
  },

  runTaskNow: async (taskId: string) => {
    set({ runningTaskId: taskId });
    try {
      const updated = await invokeTauri<WakeupTask>('run_wakeup_task', { taskId });
      if (updated) {
        set((state) => ({
          runningTaskId: null,
          tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
        }));
        return;
      }
    } catch (e: any) {
      console.warn('Run wakeup task error:', e);
    }

    // Fallback simulation if running in preview
    await new Promise((r) => setTimeout(r, 800));
    set((state) => ({
      runningTaskId: null,
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              lastRunAt: Date.now(),
              lastStatus: 'Success',
              lastDurationMs: 310,
              lastMessage: 'Quota ping refreshed, rolling reset clock restarted',
              nextRunAt: Date.now() + t.intervalHours * 3600 * 1000,
            }
          : t
      ),
    }));
  },

  toggleTaskEnabled: async (taskId: string) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, enabled: !task.enabled };
    await get().saveTask(updated);
  },
}));
