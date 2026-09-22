import { create } from 'zustand';
import { WakeupTask } from '../types/wakeup';
import { action, backend } from '../lib/backend';
interface WakeupState {
  tasks: WakeupTask[]; loading: boolean; runningTaskId: string | null;
  loadTasks: () => Promise<void>;
  saveTask: (task: WakeupTask) => Promise<boolean>;
  deleteTask: (id: string) => Promise<boolean>;
  runTaskNow: (id: string) => Promise<boolean>;
  toggleTaskEnabled: (id: string) => Promise<boolean>;
}
export const useWakeupStore = create<WakeupState>((set, get) => ({
  tasks: [], loading: false, runningTaskId: null,
  loadTasks: async () => {
    set({ loading: true });
    try { set({ tasks: await backend<WakeupTask[]>('list_wakeup_tasks') }); }
    catch { /* visible global error */ } finally { set({ loading: false }); }
  },
  saveTask: task => action(async () => {
    const saved = await backend<WakeupTask>('save_wakeup_task', { task });
    set(state => ({ tasks: [...state.tasks.filter(t => t.id !== saved.id), saved] }));
  }),
  deleteTask: taskId => action(async () => {
    await backend('delete_wakeup_task', { taskId });
    set(state => ({ tasks: state.tasks.filter(t => t.id !== taskId) }));
  }),
  runTaskNow: taskId => action(async () => {
    set({ runningTaskId: taskId });
    try {
      const task = await backend<WakeupTask>('run_wakeup_task', { taskId });
      set(state => ({ tasks: state.tasks.map(t => t.id === task.id ? task : t) }));
    } finally { set({ runningTaskId: null }); }
  }),
  toggleTaskEnabled: async id => {
    const task = get().tasks.find(t => t.id === id);
    return task ? get().saveTask({ ...task, enabled: !task.enabled }) : false;
  },
}));
