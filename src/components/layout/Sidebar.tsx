import React from 'react';
import {
  LayoutDashboard,
  Users,
  Radio,
  Boxes,
  ScrollText,
  Settings,
  AlarmClock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useGatewayStore } from '../../stores/useGatewayStore';
import logoImg from '../../assets/logo.png';

export type NavTab = 'dashboard' | 'accounts' | 'wakeup' | 'gateway' | 'instances' | 'inspector' | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const { running, port } = useGatewayStore();

  const navItems: { id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'accounts', label: 'Accounts', icon: Users },
    { id: 'wakeup', label: 'Wakeup Tasks', icon: AlarmClock },
    { id: 'gateway', label: 'Proxy Gateway', icon: Radio },
    { id: 'instances', label: 'Multi-Instance', icon: Boxes },
    { id: 'inspector', label: 'Request Logs', icon: ScrollText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-[#1E2536] bg-[#0A0C13] flex flex-col justify-between select-none">
      <div>
        {/* macOS Window Drag Region & Traffic Lights Safe Clearance */}
        <div
          data-tauri-drag-region
          className="h-10 w-full flex items-center px-4 cursor-default bg-transparent select-none"
        />

        {/* Brand Header */}
        <div className="px-5 pb-4 pt-1 flex items-center gap-3 border-b border-[#1A2130]">
          <div className="w-8 h-8 rounded-lg overflow-hidden border border-cyan-500/30 shadow-md shadow-indigo-500/20 flex-shrink-0 bg-[#0c101d]">
            <img src={logoImg} alt="CodexProxy Logo" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-tight text-zinc-100 truncate">CodexProxy</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800/80 text-zinc-400 font-mono border border-zinc-700/50 flex-shrink-0">
                v1.0
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={clsx(
                  'w-1.5 h-1.5 rounded-full flex-shrink-0',
                  running ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'
                )}
              />
              <span className="text-[11px] text-zinc-400 font-mono truncate">
                {running ? `Port :${port}` : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all group',
                  isActive
                    ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#121622] border border-transparent'
                )}
              >
                <Icon
                  className={clsx(
                    'w-4 h-4 transition-colors',
                    isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300'
                  )}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System summary */}
      <div className="p-4 border-t border-[#1A2130]">
        <div className="p-3 rounded-xl bg-[#0F121A] border border-[#1E2536] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-500">Storage</span>
            <span className="font-mono text-zinc-300">Local only</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-500">Core Engine</span>
            <span className="font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Pure Rust
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
