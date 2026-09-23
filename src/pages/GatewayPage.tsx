import React, { useEffect, useState } from 'react';
import {
  Radio,
  KeyRound,
  Plus,
  Play,
  Square,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Globe,
  LockKeyhole,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Slider } from '../components/ui/Slider';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SectionHead,
  Switch,
} from '../components/ui/Elements';
import { useGatewayStore } from '../stores/useGatewayStore';
import { RoutingStrategy } from '../types/gateway';
import { useBackendError } from '../lib/backend';

export const GatewayPage: React.FC = () => {
  const g = useGatewayStore();
  const [port, setPort] = useState(String(g.port));
  const [timeout, setTimeoutValue] = useState(String(g.requestTimeoutSeconds));
  const [retries, setRetries] = useState(String(g.maxRetries));
  const [rate, setRate] = useState(String(g.requestsPerMinute));
  const [affinity, setAffinity] = useState(g.sessionAffinityTtlSeconds);
  const [reserve, setReserve] = useState(g.quotaReservePercent);
  const [keyModal, setKeyModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  useEffect(() => setPort(String(g.port)), [g.port]);
  useEffect(() => {
    setTimeoutValue(String(g.requestTimeoutSeconds));
    setRetries(String(g.maxRetries));
    setRate(String(g.requestsPerMinute));
  }, [g.requestTimeoutSeconds, g.maxRetries, g.requestsPerMinute]);
  useEffect(() => setAffinity(g.sessionAffinityTtlSeconds), [g.sessionAffinityTtlSeconds]);
  useEffect(() => setReserve(g.quotaReservePercent), [g.quotaReservePercent]);
  const routingDirty =
    affinity !== g.sessionAffinityTtlSeconds || reserve !== g.quotaReservePercent;
  const baseUrl = 'http://127.0.0.1:' + g.port + '/v1';
  return (
    <div className="page">
      <PageHeader
        eyebrow="Connection & routing"
        title="Gateway"
        description="A single local endpoint, configured for the way you work."
        actions={
          <>
            <Badge dot variant={g.running ? 'emerald' : 'zinc'}>
              {g.running ? 'Listening' : 'Stopped'}
            </Badge>
            <Button
              variant={g.running ? 'secondary' : 'primary'}
              loading={g.busy}
              icon={g.running ? <Square size={13} /> : <Play size={13} />}
              onClick={() => void g.toggleGateway()}
            >
              {g.running ? 'Stop gateway' : 'Start gateway'}
            </Button>
          </>
        }
      />
      <div className="two-col">
        <Card>
          <SectionHead
            title="Network"
            description="Where your Codex clients connect."
            icon={<Radio className="section-icon" />}
          />
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              await g.updatePort(Number(port));
            }}
          >
            <div className="field">
              <label htmlFor="gateway-port">Listener port</label>
              <div className="flex gap-2">
                <input
                  id="gateway-port"
                  className="input mono"
                  type="number"
                  min={1}
                  max={65535}
                  required
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                />
                <Button type="submit" disabled={g.busy || Number(port) === g.port}>
                  Apply
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-2">Access scope</p>
              <div className="choice-grid">
                <button
                  type="button"
                  className="choice"
                  aria-pressed={g.scope === 'localhost'}
                  disabled={g.busy}
                  onClick={() => void g.updateScope('localhost')}
                >
                  <LockKeyhole size={17} />
                  <strong>This device</strong>
                  <small>127.0.0.1 · Recommended</small>
                </button>
                <button
                  type="button"
                  className="choice"
                  aria-pressed={g.scope === 'lan'}
                  disabled={g.busy}
                  onClick={() => void g.updateScope('lan')}
                >
                  <Globe size={17} />
                  <strong>Local network</strong>
                  <small>0.0.0.0 · Requires a client key</small>
                </button>
              </div>
            </div>
            <div>
              <span className="eyebrow">Client endpoint</span>
              <div className="endpoint">
                <code className="mono accent">{baseUrl}</code>
                <CopyButton value={baseUrl} compact label="Copy gateway endpoint" />
              </div>
            </div>
            {g.scope === 'lan' && (
              <Notice tone="warning">
                LAN traffic uses plain HTTP. Use a trusted network or a protected tunnel. Connect
                other devices using this computer's LAN address.
              </Notice>
            )}
          </form>
        </Card>
        <Card>
          <SectionHead
            title="Account routing"
            description="Choose how requests move through your pool."
            icon={<SlidersHorizontal className="section-icon" />}
          />
          <div className="stack">
            <Field label="Routing strategy">
              <select
                className="input"
                value={g.routingStrategy}
                disabled={g.busy}
                onChange={(e) => void g.updateRoutingStrategy(e.target.value as RoutingStrategy)}
              >
                <option value="auto">Automatic · quota aware</option>
                <option value="random">Random distribution</option>
                <option value="quota_high_first">Highest remaining quota</option>
                <option value="quota_low_first">Lowest remaining quota</option>
                <option value="plan_high_first">Highest plan tier</option>
                <option value="single_account">Active account only</option>
              </select>
            </Field>
            <Switch
              label="Session affinity"
              description="Keep a conversation on the same account."
              checked={g.sessionAffinity}
              disabled={g.busy}
              onChange={(enabled) =>
                void g.updateSessionAffinity(enabled, g.sessionAffinityTtlSeconds)
              }
            />
            {g.sessionAffinity && (
              <Slider
                min={300}
                max={7200}
                step={300}
                value={affinity}
                onChange={setAffinity}
                label="Affinity duration"
                formatValue={(s) => s / 60 + ' min'}
                presets={[900, 1800, 3600]}
                disabled={g.busy}
              />
            )}
            <Slider
              min={0}
              max={50}
              step={5}
              value={reserve}
              onChange={setReserve}
              label="Quota reserve"
              description="Keep this percentage available by excluding accounts below the threshold."
              unit="%"
              presets={[5, 15, 30]}
              disabled={g.busy}
            />
            {routingDirty && (
              <Button
                disabled={g.busy}
                onClick={async () => {
                  if (
                    affinity !== g.sessionAffinityTtlSeconds &&
                    !(await g.updateSessionAffinity(g.sessionAffinity, affinity))
                  )
                    return;
                  if (reserve !== g.quotaReservePercent) await g.updateQuotaReserve(reserve);
                }}
              >
                Apply routing changes
              </Button>
            )}
          </div>
        </Card>
      </div>
      <Card>
        <SectionHead
          title="Request limits"
          description="Bounded timeouts and retries. No automatic retry after a stream begins."
        />
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            await g.updateLimits({
              requestTimeoutSeconds: Number(timeout),
              maxRetries: Number(retries),
              requestsPerMinute: Number(rate),
            });
          }}
        >
          <div className="three-col">
            <Field label="Timeout (seconds)">
              <input
                className="input mono"
                type="number"
                min={5}
                max={3600}
                required
                value={timeout}
                onChange={(e) => setTimeoutValue(e.target.value)}
              />
            </Field>
            <Field label="Additional account attempts">
              <input
                className="input mono"
                type="number"
                min={0}
                max={5}
                required
                value={retries}
                onChange={(e) => setRetries(e.target.value)}
              />
            </Field>
            <Field label="Requests per minute" hint="0 means unlimited.">
              <input
                className="input mono"
                type="number"
                min={0}
                required
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
          </div>
          <div className="actions justify-end">
            <Button
              type="submit"
              disabled={
                g.busy ||
                (Number(timeout) === g.requestTimeoutSeconds &&
                  Number(retries) === g.maxRetries &&
                  Number(rate) === g.requestsPerMinute)
              }
            >
              Save limits
            </Button>
          </div>
        </form>
      </Card>
      <Card className="table-card">
        <SectionHead
          title="Client API keys"
          description="Local bearer keys for clients. Upstream credentials are never exposed."
          action={
            <Button
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => {
                useBackendError.getState().clear();
                setKeyModal(true);
              }}
            >
              New key
            </Button>
          }
        />
        {!g.apiKeys.length ? (
          <EmptyState
            icon={<KeyRound size={22} />}
            title="Your endpoint, your access rules"
            description="Native clients on this device can currently connect without a key. Add a key to require authentication."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Secret</th>
                  <th>Session tokens</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.name}</td>
                    <td>
                      <div className="actions mono small">
                        <span>{key.key.slice(0, 10)}••••••••</span>
                        <CopyButton compact value={key.key} label={'Copy key for ' + key.name} />
                      </div>
                    </td>
                    <td className="mono muted">{key.totalTokensUsed.toLocaleString()}</td>
                    <td>
                      <Badge dot variant={key.enabled ? 'emerald' : 'zinc'}>
                        {key.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </td>
                    <td>
                      <div className="actions justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={g.busy}
                          onClick={() => void g.toggleApiKey(key.id)}
                        >
                          {key.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <button
                          className="icon-button danger"
                          disabled={g.busy}
                          aria-label={'Delete key ' + key.name}
                          onClick={() => {
                            useBackendError.getState().clear();
                            setRemoveId(key.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Notice>
        <ShieldCheck className="inline mr-1" size={12} />
        Once a key exists, every client needs an enabled key. Browser-origin requests are blocked.
        Restart existing managed instances after changing ports or keys.
      </Notice>
      <Modal
        isOpen={keyModal}
        onClose={() => setKeyModal(false)}
        dismissible={!keyBusy}
        title="Create a client key"
        description="Give this key a name so you know where it is used."
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setKeyBusy(true);
            try {
              if (await g.createApiKey(keyName)) {
                setKeyName('');
                setKeyModal(false);
              }
            } finally {
              setKeyBusy(false);
            }
          }}
        >
          <Field label="Key name">
            <input
              className="input"
              required
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. Work Codex CLI"
            />
          </Field>
          <div className="modal-actions">
            <Button variant="ghost" disabled={keyBusy} onClick={() => setKeyModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={keyBusy}>
              Create key
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={removeId !== null}
        title="Delete this client key?"
        description="Clients using this key will lose access. Deleting the last key permits unauthenticated loopback access again; LAN mode requires an enabled key."
        confirmLabel="Delete key"
        onClose={() => setRemoveId(null)}
        onConfirm={() => g.deleteApiKey(removeId!)}
      />
    </div>
  );
};
