import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';

export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const useBackendError = create<{ error: string | null; clear: () => void }>((set) => ({
  error: null, clear: () => set({ error: null }),
}));

export async function backend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    if (!isDesktop()) throw new Error('Desktop backend unavailable. Run npm run tauri:dev to use accounts, gateway and scheduling.');
    return await invoke<T>(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useBackendError.setState({ error: message });
    throw new Error(message);
  }
}

/** UI event actions report failures visibly and never pretend a mutation succeeded. */
export async function action(work: () => Promise<void>): Promise<boolean> {
  useBackendError.getState().clear();
  try { await work(); return true; } catch { return false; }
}
