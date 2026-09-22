export interface WakeupTask {
  id: string;
  name: string;
  enabled: boolean;
  accountId: string;
  intervalHours: number;
  runOnStartup: boolean;
  lastRunAt?: number;
  lastStatus?: 'Success' | 'Failed' | string;
  lastDurationMs?: number;
  lastMessage?: string;
  nextRunAt?: number;
}
