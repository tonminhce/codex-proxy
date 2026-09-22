import React, { useState } from 'react';
import {
  Radio,
  Key,
  Sliders,
  Copy,
  Check,
  Plus,
  Trash2,
  Power,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Slider } from '../components/ui/Slider';
import { useGatewayStore } from '../stores/useGatewayStore';
import { RoutingStrategy } from '../types/gateway';

export const GatewayPage: React.FC = () => {
  const {
    running,
    port,
    host,
    scope,
    routingStrategy,
    sessionAffinity,
    sessionAffinityTtlSeconds,
    quotaReservePercent,
    apiKeys,
    updatePort,
    updateScope,
    updateRoutingStrategy,
    updateSessionAffinity,
    updateQuotaReserve,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    toggleGateway,
  } = useGatewayStore();

  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const handleCopyKey = (id: string, key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 1500);
  };

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    createApiKey(newKeyName);
    setIsKeyModalOpen(false);
    setNewKeyName('');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Proxy Gateway Settings</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Configure the local HTTP/WebSocket proxy gateway, load-balancing strategy, and client API keys.
          </p>
        </div>
        <Button
          variant={running ? 'danger' : 'primary'}
          icon={<Power className="w-4 h-4" />}
          onClick={toggleGateway}
        >
          {running ? 'Stop Gateway' : 'Start Gateway'}
        </Button>
      </div>

      {/* Network & Routing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Network Binding */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-2 border-b border-[#1E2536]">
            <Radio className="w-4 h-4 text-indigo-400" />
            <h3 className="font-semibold text-sm text-zinc-100">Network & Binding</h3>
          </div>

          <div className="space-y-4 text-xs font-mono">
            <div>
              <label className="block text-zinc-400 font-sans mb-1.5 font-medium">Gateway Port</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => updatePort(Number(e.target.value))}
                  className="w-32 px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-indigo-500/50 font-mono"
                />
                <span className="text-zinc-500 font-sans">Default is 8080</span>
              </div>
            </div>

            <div>
              <label className="block text-zinc-400 font-sans mb-1.5 font-medium">Access Scope</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateScope('localhost')}
                  className={`p-3 rounded-xl border text-left transition ${
                    scope === 'localhost'
                      ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300'
                      : 'bg-[#090B11] border-[#1E2536] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="font-semibold font-sans text-xs">Localhost Only</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">127.0.0.1 (Loopback)</div>
                </button>

                <button
                  type="button"
                  onClick={() => updateScope('lan')}
                  className={`p-3 rounded-xl border text-left transition ${
                    scope === 'lan'
                      ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300'
                      : 'bg-[#090B11] border-[#1E2536] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="font-semibold font-sans text-xs">LAN Exposure</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">0.0.0.0 (Local Network)</div>
                </button>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#090B11] border border-[#1E2536] text-zinc-400 font-sans text-[11px]">
              Active Gateway Base URL:{' '}
              <span className="font-mono text-emerald-400 font-semibold">http://{host}:{port}/v1</span>
            </div>
          </div>
        </Card>

        {/* Load Balancing & Routing Strategy */}
        <Card className="p-6 space-y-5">
          <div className="flex items-center gap-2.5 pb-2 border-b border-[#1E2536]">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <h3 className="font-semibold text-sm text-zinc-100">Load Balancing & Affinity</h3>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1.5 font-medium">Pool Routing Strategy</label>
              <select
                value={routingStrategy}
                onChange={(e) => updateRoutingStrategy(e.target.value as RoutingStrategy)}
                className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-zinc-200 text-xs focus:outline-none focus:border-indigo-500/50"
              >
                <option value="auto">Auto (Smart Quota & Plan Rotation)</option>
                <option value="random">Random Distribution</option>
                <option value="quota_high_first">Highest Remaining Quota First</option>
                <option value="plan_high_first">Highest Plan Tier First (Team &gt; Plus)</option>
                <option value="single_account">Single Account Pinning</option>
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-zinc-200">Session Affinity</span>
                  <p className="text-[11px] text-zinc-500">Pins conversation threads to the same account.</p>
                </div>
                <input
                  type="checkbox"
                  checked={sessionAffinity}
                  onChange={(e) => updateSessionAffinity(e.target.checked, sessionAffinityTtlSeconds)}
                  className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
                />
              </div>
              {sessionAffinity && (
                <div className="pt-2">
                  <Slider
                    min={300}
                    max={7200}
                    step={300}
                    value={sessionAffinityTtlSeconds}
                    onChange={(val) => updateSessionAffinity(true, val)}
                    label="Affinity Expiration (TTL)"
                    description="Duration a conversation thread remains bound to the same account."
                    formatValue={(sec) => `${Math.round(sec / 60)} min`}
                    presets={[900, 1800, 3600]}
                  />
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#1E2536]">
              <Slider
                min={0}
                max={50}
                step={5}
                value={quotaReservePercent}
                onChange={updateQuotaReserve}
                label="Quota Reserve Threshold"
                description="Excludes accounts from load-balancer pool when remaining quota drops below this limit."
                unit="%"
                presets={[5, 10, 15, 20, 30]}
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Client API Keys Management Card */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 px-6 border-b border-[#1E2536] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Local Client API Keys</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Keys used by external tools (Cursor, Claude Code, custom agents) to authenticate with this gateway.
              </p>
            </div>
          </div>
          <Button size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setIsKeyModalOpen(true)}>
            New API Key
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#090B11] text-zinc-400 border-b border-[#1E2536]">
              <tr>
                <th className="py-3 px-6 font-medium">Name / Label</th>
                <th className="py-3 px-4 font-medium">API Key</th>
                <th className="py-3 px-4 font-medium">Tokens Consumed</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-6 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1A2130]">
              {apiKeys.map((key) => (
                <tr key={key.id} className="hover:bg-[#121622]/50 transition-colors">
                  <td className="py-3.5 px-6">
                    <span className="font-sans font-medium text-zinc-200">{key.name}</span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-300">
                    <div className="flex items-center gap-2">
                      <span>{key.key.slice(0, 16)}••••••••</span>
                      <button
                        onClick={() => handleCopyKey(key.id, key.key)}
                        className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                      >
                        {copiedKeyId === key.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-zinc-400">
                    {key.totalTokensUsed.toLocaleString()} tokens
                  </td>
                  <td className="py-3.5 px-4">
                    <Badge variant={key.enabled ? 'emerald' : 'zinc'}>
                      {key.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="py-3.5 px-6 text-right space-x-2">
                    <button
                      onClick={() => toggleApiKey(key.id)}
                      className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                    >
                      {key.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteApiKey(key.id)}
                      className="text-xs text-zinc-500 hover:text-rose-400 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5 inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create API Key Modal */}
      <Modal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        title="Generate Local Client API Key"
        description="Creates an OpenAI-compatible authorization secret for this gateway."
      >
        <form onSubmit={handleCreateKey} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Key Name / Description</label>
            <input
              type="text"
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Cursor IDE Agent"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2536]">
            <Button type="button" variant="ghost" onClick={() => setIsKeyModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Generate Key
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
