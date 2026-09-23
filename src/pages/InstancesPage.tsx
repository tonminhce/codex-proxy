import React, { useState } from 'react';
import {
  Boxes,
  Plus,
  Play,
  Square,
  Trash2,
  Folder,
  GitBranch,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SectionHead,
} from '../components/ui/Elements';
import { useInstanceStore } from '../stores/useInstanceStore';
import { useAccountStore } from '../stores/useAccountStore';
import { useBackendError } from '../lib/backend';

export const InstancesPage: React.FC = () => {
  const store = useInstanceStore();
  const accounts = useAccountStore((s) => s.accounts);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [bound, setBound] = useState('');
  const [routeInstance, setRouteInstance] = useState<string | null>(null);
  const [namespace, setNamespace] = useState('');
  const [providerName, setProviderName] = useState('');
  const [routeAccount, setRouteAccount] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ instanceId: string; routeId?: string } | null>(null);
  const routeProvider = accounts.find((a) => a.id === routeAccount);
  const newInstance = () => {
    useBackendError.getState().clear();
    setCreateOpen(true);
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Isolated environments"
        title="Instances"
        description="Separate profiles. Independent sessions. One place to manage them."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={newInstance}>
            New instance
          </Button>
        }
      />
      <Notice>
        Instances run the Codex CLI app-server, not a separate Desktop window. Connect with{' '}
        <code className="mono">codex --remote</code> after launch. Each profile lives inside{' '}
        <code className="mono">~/.codex-proxy/profiles/</code>.
      </Notice>
      {!store.instances.length ? (
        <Card>
          <EmptyState
            icon={<Boxes size={24} />}
            title="A workspace for every context"
            description="Create an isolated profile for a project, account, or experiment. No shared auth files are copied."
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={newInstance}>
                Create your first instance
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="stack">
          {store.instances.map((instance) => (
            <Card key={instance.id} elevated={instance.isRunning}>
              <div className="account-card-head">
                <div className="account-identity">
                  <div className="avatar">
                    <Boxes size={17} />
                  </div>
                  <div className="min-w-0">
                    <h2>{instance.name}</h2>
                    <p className="small muted mt-1">
                      {instance.boundAccountId
                        ? accounts.find((a) => a.id === instance.boundAccountId)?.email ||
                          'Account unavailable'
                        : 'Using gateway account pool'}
                    </p>
                  </div>
                </div>
                <div className="actions">
                  <Badge dot variant={instance.isRunning ? 'emerald' : 'zinc'}>
                    {instance.isRunning ? 'Running · ' + instance.pid : 'Stopped'}
                  </Badge>
                  <Button
                    size="sm"
                    variant={instance.isRunning ? 'secondary' : 'primary'}
                    loading={pendingId === instance.id}
                    disabled={pendingId !== null}
                    icon={instance.isRunning ? <Square size={12} /> : <Play size={12} />}
                    onClick={async () => {
                      setPendingId(instance.id);
                      try {
                        await store.toggleInstanceRunning(instance.id);
                      } finally {
                        setPendingId(null);
                      }
                    }}
                  >
                    {instance.isRunning ? 'Stop' : 'Launch'}
                  </Button>
                  <button
                    className="icon-button danger"
                    disabled={instance.isRunning || pendingId !== null}
                    aria-label={'Remove instance ' + instance.name}
                    title="Remove instance"
                    onClick={() => {
                      useBackendError.getState().clear();
                      setRemove({ instanceId: instance.id });
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="instance-meta">
                <span className="flex items-center gap-2 min-w-0">
                  <Folder size={12} />
                  <span className="mono truncate-text" title={instance.profilePath}>
                    {instance.profilePath}
                  </span>
                </span>
              </div>
              {instance.endpoint && (
                <div className="endpoint mb-5">
                  <Terminal size={14} className="accent" />
                  <code className="mono">codex --remote {instance.endpoint}</code>
                  <CopyButton
                    compact
                    value={'codex --remote ' + instance.endpoint}
                    label="Copy instance connection command"
                  />
                </div>
              )}
              <SectionHead
                title="Model routes"
                description="Send a namespace to its registered provider account."
                icon={<GitBranch className="section-icon" />}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={instance.isRunning}
                    icon={<Plus size={13} />}
                    onClick={() => {
                      useBackendError.getState().clear();
                      setRouteInstance(instance.id);
                      setNamespace('');
                      setModel('');
                      setProviderName('');
                      setRouteAccount('');
                    }}
                  >
                    Add route
                  </Button>
                }
              />
              {!instance.routes.length ? (
                <p className="small dim py-2">
                  No custom routes. Models use the bound account or gateway pool.
                </p>
              ) : (
                instance.routes.map((route) => (
                  <div className="route-row" key={route.id}>
                    <Badge variant="indigo">{route.namespace}/*</Badge>
                    <ArrowRight size={13} className="dim" />
                    <div className="route-name">
                      <p className="mono small truncate-text">{route.upstreamModel}</p>
                      <p className="small dim truncate-text">{route.providerName}</p>
                    </div>
                    <Badge variant={route.enabled ? 'emerald' : 'zinc'}>
                      {route.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={instance.isRunning}
                      onClick={() => void store.toggleRoute(instance.id, route.id)}
                    >
                      {route.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <button
                      className="icon-button danger"
                      disabled={instance.isRunning}
                      aria-label={'Delete route ' + route.namespace}
                      onClick={() => {
                        useBackendError.getState().clear();
                        setRemove({ instanceId: instance.id, routeId: route.id });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </Card>
          ))}
        </div>
      )}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        dismissible={!busy}
        title="Create an instance"
        description="Give this workspace its own profile and account routing."
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (await store.createInstance(name, path, bound || undefined)) {
                setCreateOpen(false);
                setName('');
                setPath('');
                setBound('');
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Instance name">
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work projects"
            />
          </Field>
          <Field
            label="Profile directory (optional)"
            hint="Leave blank for an automatically generated isolated path."
          >
            <input
              className="input mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/.codex-proxy/profiles/…"
            />
          </Field>
          <Field label="Account">
            <select className="input" value={bound} onChange={(e) => setBound(e.target.value)}>
              <option value="">Gateway account pool</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}
                </option>
              ))}
            </select>
          </Field>
          <div className="modal-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create instance
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={routeInstance !== null}
        onClose={() => setRouteInstance(null)}
        dismissible={!busy}
        title="Add a model route"
        description="Only an API-key account registered for this provider can be used."
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!routeProvider || !routeInstance) return;
            setBusy(true);
            try {
              if (
                await store.addRoute(routeInstance, {
                  namespace,
                  providerName: providerName || routeProvider.name || 'Custom provider',
                  providerBaseUrl: routeProvider.apiBaseUrl || 'https://api.openai.com/v1',
                  upstreamModel: model,
                  enabled: true,
                  accountId: routeAccount,
                })
              )
                setRouteInstance(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!accounts.some((a) => a.authMode === 'apikey') && (
            <Notice tone="warning">Add an API-key account on the Accounts page first.</Notice>
          )}
          <Field label="Provider account">
            <select
              className="input"
              required
              value={routeAccount}
              onChange={(e) => setRouteAccount(e.target.value)}
            >
              <option value="">Select an API-key account</option>
              {accounts
                .filter((a) => a.authMode === 'apikey')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.email}
                  </option>
                ))}
            </select>
          </Field>
          {routeProvider && (
            <p className="small mono muted break-all">
              {routeProvider.apiBaseUrl || 'https://api.openai.com/v1'}
            </p>
          )}
          <Field label="Namespace" hint="Lowercase letters, numbers, hyphens, and underscores.">
            <input
              className="input mono"
              required
              pattern="[a-z0-9_-]+"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="e.g. work"
            />
          </Field>
          <Field label="Provider label (optional)">
            <input
              className="input"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="e.g. Work relay"
            />
          </Field>
          <Field label="Upstream model">
            <input
              className="input mono"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="A model supported by this provider"
            />
          </Field>
          <div className="modal-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setRouteInstance(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!routeProvider}>
              Add route
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={remove !== null}
        title={remove?.routeId ? 'Delete this route?' : 'Remove this instance?'}
        description={
          remove?.routeId
            ? 'Requests using this namespace will no longer be routed to the provider.'
            : 'Only the instance definition is removed. Its profile files are kept on disk.'
        }
        confirmLabel={remove?.routeId ? 'Delete route' : 'Remove instance'}
        onClose={() => setRemove(null)}
        onConfirm={() =>
          remove?.routeId
            ? store.deleteRoute(remove.instanceId, remove.routeId)
            : store.deleteInstance(remove!.instanceId)
        }
      />
    </div>
  );
};
