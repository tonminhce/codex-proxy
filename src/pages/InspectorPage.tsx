import React, { useState } from 'react';
import {
  Search,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useLogStore } from '../stores/useLogStore';
import { RequestLogEntry } from '../types/logs';

export const InspectorPage: React.FC = () => {
  const { logs, filter, setFilter, clearLogs } = useLogStore();
  const [selectedLog, setSelectedLog] = useState<RequestLogEntry | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (filter.status === 'success' && log.status !== 200) return false;
    if (filter.status === 'error' && log.status === 200) return false;
    if (
      filter.query &&
      !log.clientModel.toLowerCase().includes(filter.query.toLowerCase()) &&
      !log.path.toLowerCase().includes(filter.query.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Request Inspector & Logs</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Up to 500 local, in-memory request summaries. Prompts, responses, headers and credentials are not stored.
          </p>
        </div>
        <Button variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={clearLogs}>
          Clear Logs
        </Button>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center justify-between gap-4 p-2.5 rounded-xl bg-[#0E111A] border border-[#1E2536]">
        <div className="flex items-center gap-2 flex-1 max-w-md px-2 py-1 rounded-lg bg-[#090B11] border border-[#1E2536]">
          <Search className="w-4 h-4 text-zinc-500 ml-1" />
          <input
            type="text"
            value={filter.query || ''}
            onChange={(e) => setFilter({ query: e.target.value })}
            placeholder="Search by model or endpoint..."
            className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none font-mono"
          />
        </div>

        <div className="flex items-center p-1 rounded-lg bg-[#090B11] border border-[#1E2536] text-xs font-medium">
          <button
            onClick={() => setFilter({ status: 'all' })}
            className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
              filter.status === 'all'
                ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/30 shadow-sm font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>All</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 font-mono">
              {logs.length}
            </span>
          </button>
          <button
            onClick={() => setFilter({ status: 'success' })}
            className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
              filter.status === 'success'
                ? 'bg-emerald-600/25 text-emerald-200 border border-emerald-500/30 shadow-sm font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Success</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 font-mono">
              {logs.filter((l) => l.status === 200).length}
            </span>
          </button>
          <button
            onClick={() => setFilter({ status: 'error' })}
            className={`px-3 py-1 rounded-md transition flex items-center gap-1.5 ${
              filter.status === 'error'
                ? 'bg-rose-600/25 text-rose-200 border border-rose-500/30 shadow-sm font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Errors</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 font-mono">
              {logs.filter((l) => l.status !== 200).length}
            </span>
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <Card className="p-0 overflow-hidden mb-8 border-[#1E2536] bg-[#0E111A]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#090B11] text-zinc-400 border-b border-[#1E2536]">
              <tr>
                <th className="py-3 px-6 font-medium">Time</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Model</th>
                <th className="py-3 px-4 font-medium">Endpoint</th>
                <th className="py-3 px-4 font-medium">Latency</th>
                <th className="py-3 px-4 font-medium">Tokens</th>
                <th className="py-3 px-6 text-right font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1A2130]">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500 font-sans">
                    No requests matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-[#121622]/60 transition cursor-pointer"
                  >
                    <td className="py-3.5 px-6 text-zinc-500">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={log.status === 200 ? 'emerald' : 'rose'}>{log.status}</Badge>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-zinc-200">{log.clientModel}</td>
                    <td className="py-3.5 px-4 text-zinc-400">{log.path}</td>
                    <td className="py-3.5 px-4 text-zinc-400">{log.durationMs}ms</td>
                    <td className="py-3.5 px-4 text-zinc-300">
                      <span>{log.totalTokens.toLocaleString()}</span>
                      {log.cachedTokens > 0 && (
                        <span className="text-[10px] text-emerald-400 ml-1.5">
                          ({log.cachedTokens} cached)
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-6 text-right text-indigo-400 hover:text-indigo-300">
                      <ArrowUpRight className="w-3.5 h-3.5 inline" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Log Detail Modal */}
      <Modal
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
        title="Request Metadata"
        description={`Request ID: ${selectedLog?.id || ''}`}
      >
        {selectedLog && (
          <div className="space-y-4 text-xs font-mono">
            <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-[#090B11] border border-[#1E2536]">
              <div>
                <span className="text-zinc-500 block text-[11px]">Timestamp</span>
                <span className="text-zinc-200">{new Date(selectedLog.timestamp).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">HTTP Status</span>
                <Badge variant={selectedLog.status === 200 ? 'emerald' : 'rose'}>{selectedLog.status}</Badge>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Client Model</span>
                <span className="text-indigo-300">{selectedLog.clientModel}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Upstream Model</span>
                <span className="text-zinc-300">{selectedLog.upstreamModel}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Duration / Latency</span>
                <span className="text-zinc-300">{selectedLog.durationMs}ms</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[11px]">Route Kind</span>
                <span className="uppercase text-[11px] text-zinc-400">{selectedLog.routeKind}</span>
              </div>
            </div>

            {/* Token Breakdown */}
            <div className="p-4 rounded-xl bg-[#090B11] border border-[#1E2536] space-y-2">
              <span className="text-xs font-semibold text-zinc-300 font-sans block">Token Accounting</span>
              <div className="grid grid-cols-2 gap-2 text-zinc-400">
                <div className="flex justify-between">
                  <span>Input / Prompt:</span>
                  <span className="text-zinc-200">{selectedLog.inputTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span>Output / Completion:</span>
                  <span className="text-zinc-200">{selectedLog.outputTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cached Tokens:</span>
                  <span className="text-emerald-400">{selectedLog.cachedTokens}</span>
                </div>
                <div className="flex justify-between">
                  <span>Reasoning Tokens:</span>
                  <span className="text-purple-400">{selectedLog.reasoningTokens}</span>
                </div>
              </div>
              <div className="pt-2 border-t border-[#1E2536] flex justify-between font-semibold text-zinc-100">
                <span>Total Tokens:</span>
                <span>{selectedLog.totalTokens.toLocaleString()}</span>
              </div>
            </div>

            {selectedLog.error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[11px]">
                {selectedLog.error}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
