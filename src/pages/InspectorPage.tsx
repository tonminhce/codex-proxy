import React, { useState } from 'react';
import { Activity, ArrowUpRight, Trash2, Search, Timer, Hash } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Notice,
  PageHeader,
  SearchField,
} from '../components/ui/Elements';
import { useLogStore } from '../stores/useLogStore';
import { useBackendError } from '../lib/backend';
import { RequestLogEntry } from '../types/logs';
export const isSuccessfulRequest = (status: number) => status >= 200 && status < 300;
export const InspectorPage: React.FC = () => {
  const { logs, filter, setFilter, clearLogs } = useLogStore();
  const [selected, setSelected] = useState<RequestLogEntry | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [model, setModel] = useState('');
  const models = [...new Set(logs.map((l) => l.clientModel).filter(Boolean))];
  const query = (filter.query || '').trim().toLowerCase();
  const filtered = logs.filter(
    (log) =>
      (!query ||
        [log.clientModel, log.path, log.accountEmail || '', log.id].some((v) =>
          v.toLowerCase().includes(query),
        )) &&
      (!model || log.clientModel === model) &&
      (filter.status === 'success'
        ? isSuccessfulRequest(log.status)
        : filter.status === 'error'
          ? !isSuccessfulRequest(log.status)
          : true),
  );
  const successCount = logs.filter((log) => isSuccessfulRequest(log.status)).length;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Observability"
        title="Request logs"
        description="See what happened, without retaining what was said."
        actions={
          <Button
            variant="ghost"
            icon={<Trash2 size={14} />}
            disabled={!logs.length}
            onClick={() => {
              useBackendError.getState().clear();
              setClearOpen(true);
            }}
          >
            Clear logs
          </Button>
        }
      />
      <div className="toolbar">
        <div className="segmented" aria-label="Request status filter">
          {(
            [
              { id: 'all', label: 'All requests', count: logs.length },
              { id: 'success', label: 'Success', count: successCount },
              { id: 'error', label: 'Errors', count: logs.length - successCount },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={(filter.status || 'all') === item.id}
              onClick={() => setFilter({ status: item.id })}
            >
              {item.label}
              <span className="mono dim ml-2">{item.count}</span>
            </button>
          ))}
        </div>
        <Badge dot variant="zinc">
          In-memory · 500 max
        </Badge>
      </div>
      <div className="toolbar">
        <SearchField
          value={filter.query || ''}
          onChange={(query) => setFilter({ query })}
          placeholder="Search model, endpoint, or account…"
        />
        <select
          className="input"
          style={{ width: 180 }}
          aria-label="Filter by model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">All models</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <Card className="table-card">
        {!filtered.length ? (
          <EmptyState
            icon={logs.length ? <Search size={22} /> : <Activity size={22} />}
            title={
              logs.length ? 'Nothing matches these filters' : 'Your request history starts here'
            }
            description={
              logs.length
                ? 'Try another model or remove a filter to see more requests.'
                : 'Send a request through the gateway. Status, timing, routing, and token usage will appear here.'
            }
            action={
              logs.length ? (
                <Button
                  onClick={() => {
                    setFilter({ status: 'all', query: '' });
                    setModel('');
                  }}
                >
                  Reset filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">Gateway request metadata</caption>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Model / endpoint</th>
                  <th>Duration</th>
                  <th>Tokens</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td className="mono small muted whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td>
                      <Badge variant={isSuccessfulRequest(log.status) ? 'emerald' : 'rose'}>
                        {log.status}
                      </Badge>
                    </td>
                    <td>
                      <p className="mono small">{log.clientModel || '—'}</p>
                      <p className="small dim mt-1">
                        {log.method} {log.path}
                      </p>
                    </td>
                    <td className="mono small muted whitespace-nowrap">
                      {log.durationMs.toLocaleString()} ms
                    </td>
                    <td className="mono small">
                      {log.totalTokens.toLocaleString()}
                      {log.cachedTokens > 0 && (
                        <p className="accent mt-1">{log.cachedTokens.toLocaleString()} cached</p>
                      )}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={'Inspect request ' + log.id}
                        onClick={() => setSelected(log)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Notice>
        Metadata stays in memory until you clear it or quit the app. Prompts, responses, request
        headers, and credentials are never saved here.
      </Notice>
      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title="Request details"
        description="Routing, timing, and token accounting for this request."
      >
        {selected && (
          <div className="stack">
            <div className="flex items-center justify-between">
              <Badge variant={isSuccessfulRequest(selected.status) ? 'emerald' : 'rose'}>
                {selected.status} · {isSuccessfulRequest(selected.status) ? 'Success' : 'Error'}
              </Badge>
              <span className="small muted">{new Date(selected.timestamp).toLocaleString()}</span>
            </div>
            <div className="endpoint">
              <Hash size={13} className="dim" />
              <code className="mono small">{selected.id}</code>
              <CopyButton compact value={selected.id} label="Copy request ID" />
            </div>
            <dl className="grid grid-cols-2 gap-5">
              {[
                { name: 'Requested model', value: selected.clientModel || '—' },
                { name: 'Upstream model', value: selected.upstreamModel || '—' },
                { name: 'Route', value: selected.routeKind.replaceAll('_', ' ') },
                { name: 'Duration', value: selected.durationMs + ' ms' },
                { name: 'Account', value: selected.accountEmail || 'Not assigned' },
                { name: 'Endpoint', value: selected.method + ' ' + selected.path },
              ].map((item) => (
                <div key={item.name} className="min-w-0">
                  <dt className="small dim mb-1">{item.name}</dt>
                  <dd className="small mono break-words m-0">{item.value}</dd>
                </div>
              ))}
            </dl>
            <Card className="stack">
              <h3 className="flex items-center gap-2">
                <Timer size={14} className="dim" />
                Token accounting
              </h3>
              {[
                { name: 'Input', value: selected.inputTokens },
                { name: 'Output', value: selected.outputTokens },
                { name: 'Cached input', value: selected.cachedTokens },
                { name: 'Reasoning', value: selected.reasoningTokens },
                { name: 'Total', value: selected.totalTokens },
              ].map((item) => (
                <div className="flex justify-between small" key={item.name}>
                  <span className="muted">{item.name}</span>
                  <span className="mono">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </Card>
            {selected.error && <Notice tone="error">{selected.error}</Notice>}
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={clearOpen}
        title="Clear request history?"
        description="All in-memory request summaries will be removed. Session counters are not reset."
        confirmLabel="Clear logs"
        onClose={() => setClearOpen(false)}
        onConfirm={clearLogs}
      />
    </div>
  );
};
