import React, { useState, useEffect } from 'react';
import {
  Clock,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Calendar,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useWakeupStore } from '../stores/useWakeupStore';
import { useAccountStore } from '../stores/useAccountStore';
import { WakeupTask } from '../types/wakeup';

export const WakeupPage: React.FC = () => {
  const {
    tasks,
    runningTaskId,
    loadTasks,
    saveTask,
    deleteTask,
    runTaskNow,
    toggleTaskEnabled,
  } = useWakeupStore();
  const { accounts } = useAccountStore();

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [taskName, setTaskName] = useState('');
  const [targetAccountId, setTargetAccountId] = useState(accounts[0]?.id || '');
  const [intervalHours, setIntervalHours] = useState(4);
  const [runOnStartup, setRunOnStartup] = useState(true);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const newTask: WakeupTask = {
      id: '',
      name: taskName,
      enabled: true,
      accountId: targetAccountId || accounts[0]?.id || 'acc-default',
      intervalHours: Number(intervalHours),
      runOnStartup,
    };
    await saveTask(newTask);
    setIsModalOpen(false);
    setTaskName('');
  };

  const formatRelativeTime = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
  };

  const formatNextRun = (timestamp?: number) => {
    if (!timestamp) return 'On next trigger';
    const diffMs = timestamp - Date.now();
    if (diffMs <= 0) return 'Due now';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `in ${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    const remMins = diffMins % 60;
    return `in ${diffHours}h ${remMins}m`;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2.5">
            <span>Wakeup & Keepalive Tasks</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-mono">
              Pure Rust Scheduler
            </span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Automated background scheduler that pings Codex profiles to start rolling quota reset windows, eliminate cold starts, and keep OAuth sessions warm.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => {
            setTargetAccountId(accounts[0]?.id || '');
            setIsModalOpen(true);
          }}
        >
          New Wakeup Task
        </Button>
      </div>

      {/* Explanatory Info Card */}
      <Card elevated className="p-5 relative overflow-hidden bg-gradient-to-br from-[#121626] to-[#0A0C14] border-indigo-500/30">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <span>Rolling Rate-Limit Window Warmup</span>
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-4xl">
              OpenAI Codex accounts (Plus/Pro) enforce rolling rate-limit quota windows (e.g. 5-hour cycles). By configuring a Wakeup Task, CodexProxy sends scheduled lightweight pings in the background. This <strong>triggers the quota reset timer early</strong> so your account has refreshed and is ready at 100% capacity when you begin coding.
            </p>
          </div>
        </div>
      </Card>

      {/* Tasks List */}
      <div className="space-y-4">
        {tasks.map((task) => {
          const targetAccount = accounts.find((a) => a.id === task.accountId);
          const isRunningThis = runningTaskId === task.id;

          return (
            <Card
              key={task.id}
              elevated={task.enabled}
              className={`p-6 transition-all ${
                task.enabled ? 'border-[#1E2536] bg-[#0E111A]' : 'opacity-60 bg-[#090A0F]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-base text-zinc-100">{task.name}</h3>
                    <Badge variant={task.enabled ? 'emerald' : 'zinc'} dot={task.enabled}>
                      {task.enabled ? 'Active Scheduler' : 'Paused'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Every {task.intervalHours} hours</span>
                    <span>•</span>
                    <span>Bound: {targetAccount ? targetAccount.email : task.accountId}</span>
                    {task.runOnStartup && (
                      <>
                        <span>•</span>
                        <span className="text-indigo-400">Run on Startup</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={
                      <Play
                        className={`w-3.5 h-3.5 fill-current ${
                          isRunningThis ? 'animate-spin text-indigo-400' : ''
                        }`}
                      />
                    }
                    loading={isRunningThis}
                    onClick={() => runTaskNow(task.id)}
                  >
                    {isRunningThis ? 'Pinging Codex...' : 'Run Now'}
                  </Button>

                  <button
                    onClick={() => toggleTaskEnabled(task.id)}
                    className="p-2 text-xs rounded-lg border border-[#1E2536] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                  >
                    {task.enabled ? 'Pause' : 'Resume'}
                  </button>

                  <button
                    onClick={() => deleteTask(task.id)}
                    title="Delete task"
                    className="p-2 text-zinc-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Status & Next Trigger Bar */}
              <div className="mt-5 pt-4 border-t border-[#1E2536] flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    {task.lastStatus === 'Success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                    )}
                    <span className="text-zinc-300">Last Run: {formatRelativeTime(task.lastRunAt)}</span>
                    {task.lastDurationMs && (
                      <span className="text-zinc-500">({task.lastDurationMs}ms)</span>
                    )}
                  </div>

                  {task.lastMessage && (
                    <>
                      <span className="text-zinc-700">|</span>
                      <span className="text-zinc-400 truncate max-w-md">{task.lastMessage}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 text-zinc-500">
                  <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Next wakeup: {formatNextRun(task.nextRunAt)}</span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create Task Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create Codex Wakeup Task"
        description="Schedule automated keepalive and rate-limit reset triggers."
      >
        <form onSubmit={handleCreateTask} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Task Name</label>
            <input
              type="text"
              required
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="e.g. Work Profile 4h Quota Reset"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Target Codex Account</label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email} ({a.email})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Trigger Interval</label>
              <select
                value={intervalHours}
                onChange={(e) => setIntervalHours(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/50"
              >
                <option value={2}>Every 2 hours</option>
                <option value={4}>Every 4 hours (Recommended)</option>
                <option value={6}>Every 6 hours</option>
                <option value={8}>Every 8 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Every 24 hours (Daily)</option>
              </select>
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none py-2">
                <input
                  type="checkbox"
                  checked={runOnStartup}
                  onChange={(e) => setRunOnStartup(e.target.checked)}
                  className="rounded border-[#1E2536] text-indigo-600 focus:ring-0 w-4 h-4 bg-[#090B11]"
                />
                <span>Run wakeup on app startup</span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2536]">
            <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Schedule Task
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
