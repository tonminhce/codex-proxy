import React from 'react';
import {
  Play,
  Square,
  Copy,
  Check,
  Zap,
  ShieldCheck,
  Layers,
  ArrowUpRight,
  TrendingUp,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useGatewayStore } from '../stores/useGatewayStore';
import { useAccountStore } from '../stores/useAccountStore';
import { useLogStore } from '../stores/useLogStore';
import { NavTab } from '../components/layout/Sidebar';

interface DashboardPageProps {
  onNavigate: (tab: NavTab) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const { running, port, toggleGateway, stats, routingStrategy, sessionAffinity, busy } = useGatewayStore();
  const { activeAccount, accounts, switchActiveAccount } = useAccountStore();
  const { logs } = useLogStore();
  const [copied, setCopied] = React.useState(false);

  const baseUrl = `http://127.0.0.1:${port}/v1`;

  const copyBaseUrl = () => {
    navigator.clipboard.writeText(baseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Gateway Dashboard</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Local OpenAI-compatible proxy gateway and Codex multi-account manager.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={running ? 'danger' : 'primary'}
            icon={running ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            onClick={toggleGateway}
            disabled={busy}
          >
            {running ? 'Stop Gateway' : 'Start Gateway'}
          </Button>
        </div>
      </div>

      {/* Primary Status Banner Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Gateway Connection Card */}
        <Card elevated className="relative overflow-hidden group">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-medium text-zinc-400">Endpoint Service</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-zinc-100 font-mono">Port :{port}</span>
                <Badge variant={running ? 'emerald' : 'zinc'} dot={running}>
                  {running ? 'Online' : 'Stopped'}
                </Badge>
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Zap className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1E2536] flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400 truncate max-w-[200px]">{baseUrl}</span>
            <button
              onClick={copyBaseUrl}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-mono transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </Card>

        {/* Active Account Summary Card */}
        <Card elevated className="relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-medium text-zinc-400">Active Codex Account</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100 truncate max-w-[180px]">
                  {activeAccount?.name || 'No account active'}
                </span>
                {activeAccount && (
                  <Badge variant="indigo" className="uppercase text-[10px]">
                    {activeAccount.planType}
                  </Badge>
                )}
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1E2536] flex items-center justify-between text-xs">
            <span className="text-zinc-500">Hourly Quota:</span>
            <span className="font-mono text-emerald-400 font-semibold">
              {activeAccount && activeAccount.quota.updatedAt > 0 ? `${activeAccount.quota.hourly.remainingPercent}% rem.` : 'Unknown'}
            </span>
          </div>
        </Card>

        {/* Metrics Summary Card */}
        <Card elevated className="relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-medium text-zinc-400">Requests This Session</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold font-mono text-zinc-100">
                  {stats.totalRequests.toLocaleString()}
                </span>
                <span className="text-xs text-emerald-400 font-mono flex items-center">
                  <TrendingUp className="w-3 h-3 mr-0.5" /> {stats.totalRequests ? `${(100 * stats.successfulRequests / stats.totalRequests).toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1E2536] flex items-center justify-between text-xs">
            <span className="text-zinc-500">Tokens Processed:</span>
            <span className="font-mono text-zinc-300">{(stats.totalTokens / 1000).toFixed(1)}k tokens</span>
          </div>
        </Card>
      </div>

      {/* Active Account Quota & Strategy Detail Grid */}
      {activeAccount && activeAccount.quota.updatedAt > 0 && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Active Profile Quota Windows</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Last fetched: {new Date(activeAccount.quota.updatedAt).toLocaleString()}. Limits are reported by the upstream account.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNavigate('accounts')}>
              Manage Accounts <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <div className="p-4 rounded-xl bg-[#090B11] border border-[#1E2536] space-y-3">
              <ProgressBar
                value={activeAccount.quota.hourly.remainingPercent}
                label="Hourly Rate Limit"
                sublabel={`${activeAccount.quota.hourly.remainingPercent}% Available`}
                variant="emerald"
              />
              <div className="flex justify-between text-[11px] text-zinc-500 font-mono">
                <span>Reset: {activeAccount.quota.hourly.resetMinutesRemaining == null ? 'Unknown' : `${activeAccount.quota.hourly.resetMinutesRemaining}m`}</span>
                <span>Consumed: {activeAccount.quota.hourly.usedPercent}%</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#090B11] border border-[#1E2536] space-y-3">
              <ProgressBar
                value={activeAccount.quota.weekly.remainingPercent}
                label="Weekly Rate Limit"
                sublabel={`${activeAccount.quota.weekly.remainingPercent}% Available`}
                variant="emerald"
              />
              <div className="flex justify-between text-[11px] text-zinc-500 font-mono">
                <span>Reset: {activeAccount.quota.weekly.resetMinutesRemaining == null ? 'Unknown' : `${Math.round(activeAccount.quota.weekly.resetMinutesRemaining / 60)}h`}</span>
                <span>Consumed: {activeAccount.quota.weekly.usedPercent}%</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Pool Accounts Table */}
      <Card className="p-0 overflow-hidden border-[#1E2536] bg-[#0E111A]">
        <div className="p-4 px-6 border-b border-[#1E2536] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Account Pool Routing</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Active Strategy: <span className="font-mono text-indigo-400 font-medium">{routingStrategy}</span> • Session affinity {sessionAffinity ? 'on' : 'off'}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onNavigate('accounts')}>
            Configure Pool
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#090B11] text-zinc-400 border-b border-[#1E2536] font-mono">
              <tr>
                <th className="py-3 px-6 font-medium">Account Profile</th>
                <th className="py-3 px-4 font-medium">Plan</th>
                <th className="py-3 px-4 font-medium">Hourly Quota</th>
                <th className="py-3 px-4 font-medium">Weekly Quota</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-6 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1A2130]">
              {accounts.map((acc) => {
                const initialLetter = (acc.name || acc.email || 'C').charAt(0).toUpperCase();
                const isAccActive = acc.id === activeAccount?.id;

                return (
                  <tr
                    key={acc.id}
                    className={`transition-colors ${
                      isAccActive ? 'bg-indigo-950/15 hover:bg-indigo-950/25' : 'hover:bg-[#121622]/60'
                    }`}
                  >
                    <td className="py-3.5 px-6">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs select-none ${
                            isAccActive
                              ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm'
                              : 'bg-zinc-800 text-zinc-400 border border-white/[0.06]'
                          }`}
                        >
                          {initialLetter}
                        </div>
                        <div>
                          <div className="font-medium text-zinc-200">{acc.name || acc.email}</div>
                          <div className="text-[11px] text-zinc-500 font-mono truncate max-w-[200px]">
                            {acc.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <Badge variant="indigo" className="uppercase text-[9px]">
                        {acc.planType}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="w-28 space-y-1">
                        <ProgressBar value={acc.quota.hourly.remainingPercent} />
                        <span className="text-[10px] text-zinc-400 font-mono block text-right">
                          {acc.quota.hourly.remainingPercent}% rem.
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="w-28 space-y-1">
                        <ProgressBar value={acc.quota.weekly.remainingPercent} />
                        <span className="text-[10px] text-zinc-400 font-mono block text-right">
                          {acc.quota.weekly.remainingPercent}% rem.
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      {isAccActive ? (
                        <Badge variant="emerald" dot>
                          Active Profile
                        </Badge>
                      ) : acc.isCooldown ? (
                        <Badge variant="amber" dot>
                          Cooling
                        </Badge>
                      ) : (
                        <Badge variant="zinc">Standby</Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      {!isAccActive && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => switchActiveAccount(acc.id)}
                          className="text-xs hover:border-indigo-500/40 hover:text-indigo-300"
                        >
                          Switch
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Live Request Stream Mini */}
      <Card className="p-0 overflow-hidden border-[#1E2536] bg-[#0E111A] mb-8">
        <div className="p-4 px-6 border-b border-[#1E2536] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <h2 className="text-sm font-semibold text-zinc-100">Live Request Stream</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onNavigate('inspector')}>
            View All Logs ({logs.length}) <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        <div className="divide-y divide-[#1A2130]">
          {logs.slice(0, 3).map((log) => (
            <div
              key={log.id}
              className="py-3.5 px-6 flex items-center justify-between text-xs font-mono hover:bg-[#121622]/40 transition"
            >
              <div className="flex items-center gap-3.5">
                <Badge variant={log.status === 200 ? 'emerald' : 'rose'}>{log.status}</Badge>
                <span className="text-zinc-200 font-semibold">{log.clientModel}</span>
                <span className="text-zinc-500 truncate max-w-[180px]">{log.path}</span>
              </div>
              <div className="flex items-center gap-5 text-zinc-400">
                <span className="text-zinc-400">{log.durationMs}ms</span>
                <span className="text-zinc-300">{log.totalTokens.toLocaleString()} tokens</span>
                <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
