import React from 'react';
import { LayoutDashboard, Users, Radio, Boxes, ScrollText, Settings, AlarmClock, Command, ArrowUpRight } from 'lucide-react';
import { useGatewayStore } from '../../stores/useGatewayStore';
import { useAccountStore } from '../../stores/useAccountStore';
import { Badge } from '../ui/Badge';
export type NavTab = 'dashboard' | 'accounts' | 'wakeup' | 'gateway' | 'instances' | 'inspector' | 'settings';
export const navigation: { id: NavTab; label: string; icon: React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; group: string; description: string }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, group: 'Workspace', description: 'Gateway health and recent activity' },
  { id: 'accounts', label: 'Accounts', icon: Users, group: 'Workspace', description: 'Connected profiles and quota' },
  { id: 'gateway', label: 'Gateway', icon: Radio, group: 'Workspace', description: 'Network, routing and client keys' },
  { id: 'instances', label: 'Instances', icon: Boxes, group: 'Operations', description: 'Isolated Codex environments' },
  { id: 'wakeup', label: 'Schedules', icon: AlarmClock, group: 'Operations', description: 'Automated quota checks' },
  { id: 'inspector', label: 'Request logs', icon: ScrollText, group: 'Operations', description: 'Request metadata and diagnostics' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'Preferences', description: 'Local paths and desktop behavior' },
];
interface SidebarProps { currentTab: NavTab; onSelectTab: (tab: NavTab) => void; }
export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const { running, port } = useGatewayStore(); const count = useAccountStore(s => s.accounts.length);
  return <aside className="sidebar"><div className="sidebar-drag" data-tauri-drag-region /><div className="brand"><div className="brand-symbol"><Command size={19} aria-hidden="true" /></div><div className="brand-name">codex<span>proxy</span></div></div>
    <nav aria-label="Main navigation">{['Workspace', 'Operations', 'Preferences'].map(group => <div key={group}><div className="nav-section">{group}</div><div className="nav-items">{navigation.filter(n => n.group === group).map(item => <button className="nav-item" aria-label={item.label} title={item.label} aria-current={currentTab === item.id ? 'page' : undefined} onClick={() => onSelectTab(item.id)} key={item.id}><item.icon size={16} aria-hidden /><span className="nav-label">{item.label}</span>{item.id === 'accounts' && count > 0 && <span className="nav-count">{count}</span>}</button>)}</div></div>)}</nav>
    <div className="sidebar-bottom"><div className="runtime-card"><div className="flex justify-between items-center"><span className="small">Local gateway</span><Badge dot variant={running ? 'emerald' : 'zinc'}>{running ? 'Live' : 'Offline'}</Badge></div><p className="mono">127.0.0.1:{port}</p><button className="btn btn-ghost btn-sm mt-2 w-full justify-between" onClick={() => onSelectTab('gateway')}>Manage connection<ArrowUpRight size={13} /></button></div><p className="nav-label dim small text-center mt-4">Built for your local workflow.</p></div>
  </aside>;
};
