import React from 'react';
import { ShieldCheck, Check, Copy, Lock, Cpu } from 'lucide-react';
import { useGatewayStore } from '../../stores/useGatewayStore';
import { useAccountStore } from '../../stores/useAccountStore';

export const StatusBar: React.FC = () => {
  const { running, port, host } = useGatewayStore();
  const { activeAccount } = useAccountStore();
  const [copied, setCopied] = React.useState(false);

  const baseUrl = `http://${host}:${port}/v1`;

  const copyBaseUrl = () => {
    navigator.clipboard.writeText(baseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <footer className="h-8 border-t border-white/[0.06] bg-[#0A0C13]/95 backdrop-blur-md px-4 flex items-center justify-between text-[11px] font-mono select-none overflow-hidden flex-shrink-0">
      {/* Left side: Gateway and active account status */}
      <div className="flex items-center gap-3.5 min-w-0 flex-shrink-0">
        {/* Gateway connection pill */}
        <div className="flex items-center gap-2 whitespace-nowrap flex-shrink-0">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            {running && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                running ? 'bg-emerald-400' : 'bg-zinc-600'
              }`}
            />
          </span>
          <span className="text-zinc-500">Gateway:</span>
          <span className={`font-semibold ${running ? 'text-emerald-400' : 'text-zinc-500'}`}>
            {running ? baseUrl : 'Stopped'}
          </span>
          {running && (
            <button
              onClick={copyBaseUrl}
              title="Copy Base URL"
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          )}
        </div>

        <span className="text-zinc-800 flex-shrink-0">|</span>

        {/* Active account profile */}
        <div className="flex items-center gap-2 min-w-0 whitespace-nowrap flex-shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          <span className="text-zinc-500">Profile:</span>
          <span className="text-zinc-200 font-medium truncate max-w-[220px]">
            {activeAccount?.email || 'No active account'}
          </span>
          {activeAccount?.planType && (
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {activeAccount.planType}
            </span>
          )}
        </div>
      </div>

      {/* Right side: Security and Rust engine badges */}
      <div className="flex items-center gap-2.5 text-zinc-500 whitespace-nowrap flex-shrink-0 pl-4">
        <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900/80 border border-white/[0.05]">
          <Lock className="w-2.5 h-2.5 text-emerald-400" />
          <span className="text-zinc-400 text-[10px]">Zero-Retention Proxy</span>
        </div>
        <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-zinc-900/80 border border-white/[0.05]">
          <Cpu className="w-2.5 h-2.5 text-indigo-400" />
          <span className="text-zinc-400 text-[10px]">Rust In-Process</span>
        </div>
      </div>
    </footer>
  );
};
