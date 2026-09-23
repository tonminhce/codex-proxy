import React from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Activity,
  Users,
  Radio,
  ShieldCheck,
  Zap,
  Plus,
  Play,
  Square,
  Terminal,
  Boxes,
  Clock3,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { CopyButton, EmptyState, PageHeader, SectionHead } from '../components/ui/Elements';
import { useGatewayStore } from '../stores/useGatewayStore';
import { useAccountStore } from '../stores/useAccountStore';
import { useLogStore } from '../stores/useLogStore';
import { NavTab } from '../components/layout/Sidebar';
export const DashboardPage: React.FC<{ onNavigate: (tab: NavTab) => void }> = ({ onNavigate }) => {
  const gateway = useGatewayStore();
  const { accounts, activeAccount } = useAccountStore();
  const logs = useLogStore((s) => s.logs);
  const stats = gateway.stats;
  const baseUrl = 'http://127.0.0.1:' + gateway.port + '/v1';
  const success = stats.totalRequests
    ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1) + '%'
    : '—';
  const metrics = [
    {
      label: 'Connected accounts',
      value: accounts.length.toString().padStart(2, '0'),
      note: 'In your local account pool',
      icon: Users,
    },
    {
      label: 'Requests',
      value: stats.totalRequests.toLocaleString(),
      note: 'Since this app started',
      icon: Activity,
    },
    {
      label: 'Tokens processed',
      value: Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
        stats.totalTokens,
      ),
      note: 'Reported by the upstream',
      icon: Zap,
    },
    {
      label: 'Success rate',
      value: success,
      note: stats.failedRequests + ' failed requests this session',
      icon: ShieldCheck,
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Your local control plane"
        title="Workspace overview"
        description="A clear view of your accounts, gateway, and everything flowing through."
        actions={
          <Badge variant="zinc">
            <ShieldCheck size={11} />
            Local-first
          </Badge>
        }
      />
      <Card className="hero">
        <div>
          <div className="hero-label">
            <Radio size={14} />
            CODEX GATEWAY
            <Badge dot variant={gateway.running ? 'emerald' : 'zinc'}>
              {gateway.running ? 'Online' : 'Offline'}
            </Badge>
          </div>
          <h2>
            {gateway.running
              ? 'Your workspace is connected.'
              : 'One gateway. Your entire workflow.'}
          </h2>
          <p>
            {gateway.running
              ? 'Your local endpoint is accepting requests. Account routing and session affinity are managed here.'
              : accounts.length
                ? 'Your accounts are ready. Start the gateway to connect your Codex clients.'
                : 'Connect an account, start your gateway, and bring your Codex workflow together.'}
          </p>
        </div>
        <div className="hero-side">
          <span className="small dim">LOCAL ENDPOINT</span>
          <div className="endpoint">
            <Terminal size={14} className="accent" />
            <code className="mono accent">{baseUrl}</code>
            <CopyButton compact value={baseUrl} label="Copy gateway endpoint" />
          </div>
          <div className="actions">
            <Button variant="ghost" size="sm" onClick={() => onNavigate('gateway')}>
              Configure
              <ArrowUpRight size={13} />
            </Button>
            <Button
              variant={gateway.running ? 'secondary' : 'primary'}
              loading={gateway.busy}
              icon={gateway.running ? <Square size={13} /> : <Play size={13} />}
              onClick={() => void gateway.toggleGateway()}
            >
              {gateway.running ? 'Stop gateway' : 'Start gateway'}
            </Button>
          </div>
        </div>
      </Card>
      <div className="metrics">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <div className="metric-label">
              <span>{metric.label}</span>
              <metric.icon size={14} className="dim" />
            </div>
            <div className="metric-value">{metric.value}</div>
            <span className="metric-note">{metric.note}</span>
          </div>
        ))}
      </div>
      <div className="two-col">
        <Card>
          <SectionHead
            title="Active profile"
            description="The selected account in your local pool."
            action={
              <Button size="sm" variant="ghost" onClick={() => onNavigate('accounts')}>
                Manage
                <ArrowUpRight size={13} />
              </Button>
            }
          />
          {activeAccount ? (
            <div className="stack">
              <div className="account-identity">
                <span className="avatar">
                  {(activeAccount.name || activeAccount.email).charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate-text">{activeAccount.name || activeAccount.email}</h3>
                  <p className="small muted truncate-text">{activeAccount.email}</p>
                </div>
                <Badge>{activeAccount.planType}</Badge>
              </div>
              {activeAccount.authMode === 'oauth' && activeAccount.quota.updatedAt > 0 ? (
                <div className="quota-grid">
                  <ProgressBar
                    label="Primary window"
                    value={activeAccount.quota.hourly.remainingPercent}
                  />
                  <ProgressBar
                    label="Weekly window"
                    value={activeAccount.quota.weekly.remainingPercent}
                  />
                </div>
              ) : (
                <p className="small muted">
                  {activeAccount.authMode === 'apikey'
                    ? 'API-key account. Usage limits are managed by your provider.'
                    : 'Quota has not been fetched yet. Refresh it from Accounts.'}
                </p>
              )}
              <div className="flex items-center gap-2 small dim">
                <ShieldCheck size={13} />
                Credentials stay in local storage.
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Users size={21} />}
              title="Make your first connection"
              description="Sign in with OpenAI or add an API-key account. Your credentials remain on this device."
              action={
                <Button size="sm" icon={<Plus size={13} />} onClick={() => onNavigate('accounts')}>
                  Connect an account
                </Button>
              }
            />
          )}
        </Card>
        <Card>
          <SectionHead
            title="Workspace shortcuts"
            description="Everything you need, one step away."
          />
          <button className="quick-link" onClick={() => onNavigate('gateway')}>
            <Radio size={17} className="dim" />
            <span>
              Configure routing<small>Manage account selection and client access</small>
            </span>
            <ArrowRight size={14} />
          </button>
          <button className="quick-link" onClick={() => onNavigate('instances')}>
            <Boxes size={17} className="dim" />
            <span>
              Isolate a workspace<small>Launch a dedicated Codex CLI app server</small>
            </span>
            <ArrowRight size={14} />
          </button>
          <button className="quick-link" onClick={() => onNavigate('wakeup')}>
            <Clock3 size={17} className="dim" />
            <span>
              Schedule a quota check<small>Keep account usage information up to date</small>
            </span>
            <ArrowRight size={14} />
          </button>
        </Card>
      </div>
      <Card className="table-card">
        <SectionHead
          title="Recent activity"
          description="Request metadata only. Never your prompts or responses."
          action={
            <Button size="sm" variant="ghost" onClick={() => onNavigate('inspector')}>
              View all
              <ArrowUpRight size={13} />
            </Button>
          }
        />
        {logs.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Endpoint</th>
                  <th>Duration</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 5).map((log) => (
                  <tr key={log.id}>
                    <td>
                      <Badge variant={log.status >= 200 && log.status < 300 ? 'emerald' : 'rose'}>
                        {log.status}
                      </Badge>
                    </td>
                    <td className="mono">{log.clientModel || '—'}</td>
                    <td className="small muted mono">{log.path}</td>
                    <td className="mono muted">{log.durationMs} ms</td>
                    <td className="mono">{log.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Activity size={21} />}
            title="A quiet workspace"
            description="Your requests will appear here as soon as a client connects to the gateway."
          />
        )}
      </Card>
    </div>
  );
};
