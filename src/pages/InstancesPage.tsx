import React, { useState } from 'react';
import {
  Play,
  Square,
  Plus,
  Trash2,
  Folder,
  Split,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useInstanceStore } from '../stores/useInstanceStore';
import { useAccountStore } from '../stores/useAccountStore';

export const InstancesPage: React.FC = () => {
  const {
    instances,
    createInstance,
    toggleInstanceRunning,
    deleteInstance,
    addRoute,
    toggleRoute,
    deleteRoute,
  } = useInstanceStore();
  const { accounts } = useAccountStore();

  const [isNewInstModalOpen, setIsNewInstModalOpen] = useState(false);
  const [instName, setInstName] = useState('');
  const [instPath, setInstPath] = useState('');
  const [boundAccountId, setBoundAccountId] = useState('');
  const [routeAccountId, setRouteAccountId] = useState('');

  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [selectedInstId, setSelectedInstId] = useState<string | null>(null);
  const [routeNamespace, setRouteNamespace] = useState('');
  const [routeProviderName, setRouteProviderName] = useState('');
  const [routeProviderUrl, setRouteProviderUrl] = useState('https://api.openai.com/v1');
  const [routeUpstreamModel, setRouteUpstreamModel] = useState('');

  const handleCreateInst = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!await createInstance(instName, instPath, boundAccountId || undefined)) return;
    setIsNewInstModalOpen(false);
    setInstName('');
    setInstPath('');
  };

  const handleAddRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInstId) return;
    if (!await addRoute(selectedInstId, {
      namespace: routeNamespace.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
      providerName: routeProviderName,
      providerBaseUrl: routeProviderUrl,
      upstreamModel: routeUpstreamModel,
      enabled: true,
      accountId: routeAccountId,
    })) return;
    setIsRouteModalOpen(false);
    setRouteNamespace('');
    setRouteProviderName('');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Multi-Instance & Model Routing</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Run isolated Codex CLI app-server processes and route model namespaces using provider-specific API keys.
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setIsNewInstModalOpen(true)}>
          New Instance
        </Button>
      </div>

      {/* Instances List */}
      <div className="space-y-5">
        {instances.length === 0 && <Card><p className="text-sm text-zinc-400">No instances yet. Create an isolated profile to launch a Codex app-server. Removing an instance keeps its profile files.</p></Card>}
        {instances.map((inst) => {
          const boundAcc = accounts.find((a) => a.id === inst.boundAccountId);
          return (
            <Card key={inst.id} elevated={inst.isRunning} className="p-6 space-y-5">
              {/* Instance Header */}
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-base text-zinc-100">{inst.name}</h3>
                    <Badge variant={inst.isRunning ? 'emerald' : 'zinc'} dot={inst.isRunning}>
                      {inst.isRunning ? `Running (PID ${inst.pid})` : 'Stopped'}
                    </Badge>
                  </div>
                  {inst.endpoint && <p className="text-xs text-indigo-300 font-mono select-text">Connect: codex --remote {inst.endpoint}</p>}
                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                    <Folder className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Profile: {inst.profilePath}</span>
                    <span>•</span>
                    <span>Bound: {boundAcc ? boundAcc.email : 'None'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={inst.isRunning ? 'danger' : 'secondary'}
                    icon={inst.isRunning ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    onClick={() => toggleInstanceRunning(inst.id)}
                  >
                    {inst.isRunning ? 'Stop' : 'Launch App Server'}
                  </Button>
                  {inst.id !== 'inst-default' && (
                    <button
                      onClick={() => deleteInstance(inst.id)}
                      className="p-2 text-zinc-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Mixed Model Routing Section for this instance */}
              <div className="pt-4 border-t border-[#1E2536] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Split className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-zinc-200">Mixed Model Routes</span>
                    <span className="text-[11px] text-zinc-500">
                      (Route custom namespaces like <code className="text-indigo-300">cpa/*</code> or{' '}
                      <code className="text-indigo-300">deepseek/*</code> without logging out)
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={inst.isRunning}
                    icon={<Plus className="w-3 h-3" />}
                    onClick={() => {
                      setSelectedInstId(inst.id);
                      setIsRouteModalOpen(true);
                    }}
                  >
                    Add Route
                  </Button>
                </div>

                {inst.routes.length === 0 ? (
                  <div className="p-4 rounded-xl bg-[#080A10] border border-[#1A2130] text-center text-xs text-zinc-500">
                    No custom routes configured. Requests use the bound account, or the gateway pool if unbound.
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#1E2536] overflow-hidden bg-[#080A10]">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#0A0D15] text-zinc-400 border-b border-[#1E2536] font-mono">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">Namespace</th>
                          <th className="py-2.5 px-4 font-medium">Provider Name</th>
                          <th className="py-2.5 px-4 font-medium">Target Upstream Model</th>
                          <th className="py-2.5 px-4 font-medium">Status</th>
                          <th className="py-2.5 px-4 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#181F2F]">
                        {inst.routes.map((route) => (
                          <tr key={route.id} className="hover:bg-[#121624]/60 transition">
                            <td className="py-3 px-4">
                              <span className="inline-block px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/25 text-indigo-300 font-mono text-xs font-semibold">
                                {route.namespace}/*
                              </span>
                            </td>
                            <td className="py-3 px-4 text-zinc-200 font-medium">{route.providerName}</td>
                            <td className="py-3 px-4 text-zinc-400 font-mono">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-800/80 border border-white/[0.04] text-zinc-300">
                                <ArrowRight className="w-3 h-3 text-zinc-500" />
                                {route.upstreamModel}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono">
                              <Badge variant={route.enabled ? 'emerald' : 'zinc'} dot={route.enabled}>
                                {route.enabled ? 'Active' : 'Disabled'}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right space-x-2">
                              <button
                                onClick={() => toggleRoute(inst.id, route.id)}
                                className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                              >
                                {route.enabled ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                onClick={() => deleteRoute(inst.id, route.id)}
                                className="text-xs text-zinc-500 hover:text-rose-400 transition"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Create Instance Modal */}
      <Modal
        isOpen={isNewInstModalOpen}
        onClose={() => setIsNewInstModalOpen(false)}
        title="Create New Codex Instance"
        description="Configures an isolated directory with its own auth.json and conversation history."
      >
        <form onSubmit={handleCreateInst} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Instance Name</label>
            <input
              type="text"
              required
              value={instName}
              onChange={(e) => setInstName(e.target.value)}
              placeholder="e.g. Work Client 2"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Profile Directory (Optional)</label>
            <input
              type="text"
              value={instPath}
              onChange={(e) => setInstPath(e.target.value)}
              placeholder="Auto-generated inside ~/.codex-proxy/profiles/"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <label className="block text-xs text-zinc-300">Bound account<select className="mt-2 w-full bg-[#090B11] border border-[#1E2536] rounded-lg p-2" value={boundAccountId} onChange={e => setBoundAccountId(e.target.value)}><option value="">Gateway account pool</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}</select></label>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2536]">
            <Button type="button" variant="ghost" onClick={() => setIsNewInstModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create Instance
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Mixed Route Modal */}
      <Modal
        isOpen={isRouteModalOpen}
        onClose={() => setIsRouteModalOpen(false)}
        title="Add Mixed Model Route"
        description="Directs a model prefix to a custom API provider without replacing your official login."
      >
        <form onSubmit={handleAddRoute} className="space-y-4">
          <label className="block text-xs text-zinc-300">Provider API-key account<select required className="mt-2 w-full bg-[#090B11] border border-[#1E2536] rounded-lg p-2" value={routeAccountId} onChange={e => { setRouteAccountId(e.target.value); const account = accounts.find(a => a.id === e.target.value); if (account) setRouteProviderUrl(account.apiBaseUrl || 'https://api.openai.com/v1'); }}><option value="">Select a configured API-key account</option>{accounts.filter(a => a.authMode === 'apikey').map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}</select></label>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Namespace Prefix</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                value={routeNamespace}
                onChange={(e) => setRouteNamespace(e.target.value)}
                placeholder="e.g. cpa, deepseek"
                className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/50"
              />
              <span className="text-zinc-500 font-mono">/model</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Provider Name</label>
            <input
              type="text"
              required
              value={routeProviderName}
              onChange={(e) => setRouteProviderName(e.target.value)}
              placeholder="e.g. CPA Enterprise Relay"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-sm text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Provider Base URL</label>
            <input
              type="url"
              required
              value={routeProviderUrl}
              onChange={(e) => setRouteProviderUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">Upstream Target Model</label>
            <input
              type="text"
              required
              value={routeUpstreamModel}
              onChange={(e) => setRouteUpstreamModel(e.target.value)}
              placeholder="e.g. gpt-5.5 or deepseek-v4-flash"
              className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2536]">
            <Button type="button" variant="ghost" onClick={() => setIsRouteModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Attach Route
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
