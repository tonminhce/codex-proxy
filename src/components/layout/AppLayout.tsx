import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Search, ArrowUpRight, Command } from 'lucide-react';
import { Sidebar, NavTab, navigation } from './Sidebar';
import { StatusBar } from './StatusBar';
import { Modal } from '../ui/Modal';
import { SearchField } from '../ui/Elements';
interface AppLayoutProps { currentTab: NavTab; onSelectTab: (tab: NavTab) => void; children: React.ReactNode; }
export const AppLayout: React.FC<AppLayoutProps> = ({ currentTab, onSelectTab, children }) => {
  const [commandOpen, setCommandOpen] = useState(false); const [query, setQuery] = useState('');
  const main = useRef<HTMLElement>(null); const current = navigation.find(n => n.id === currentTab)!;
  const results = navigation.filter(n => (n.label + ' ' + n.description).toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { if (main.current) main.current.scrollTop = 0; }, [currentTab]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !document.querySelector('[role="dialog"]')) { e.preventDefault(); setQuery(''); setCommandOpen(true); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, []);
  const navigate = (id: NavTab) => { onSelectTab(id); setCommandOpen(false); };
  return <><div id="app-shell" className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><Sidebar currentTab={currentTab} onSelectTab={onSelectTab} /><div className="app-body">
    <header className="topbar" data-tauri-drag-region><div className="breadcrumb"><span>{current.group}</span><ChevronRight size={12} aria-hidden /><strong>{current.label}</strong></div><button className="search-trigger" onClick={() => { setQuery(''); setCommandOpen(true); }} aria-label="Quick navigation"><Search size={13} /><span>Go to…</span><kbd>⌘ K</kbd></button></header>
    <main className="main-scroll" id="main-content" ref={main} tabIndex={-1}><div key={currentTab} className="page-enter">{children}</div></main><StatusBar />
  </div></div><Modal isOpen={commandOpen} onClose={() => setCommandOpen(false)} title="Go to a page" description="Find your way around the workspace.">
    <div onKeyDown={e => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement && results[0]) { e.preventDefault(); navigate(results[0].id); } if (e.key === 'ArrowDown') { e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.command-item')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index + 1) % buttons.length]?.focus(); } if (e.key === 'ArrowUp') { e.preventDefault(); const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.command-item')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); } }}>
      <SearchField value={query} onChange={setQuery} placeholder="Search pages…" /><div className="command-list">{results.map(item => <button key={item.id} className="command-item" onClick={() => navigate(item.id)}><item.icon size={16} /><span>{item.label}<small className="block dim mt-1">{item.description}</small></span><ArrowUpRight size={13} /></button>)}{results.length === 0 && <p className="subtle py-5 text-center">No pages found. Try “accounts” or “gateway”.</p>}</div><div className="flex items-center gap-2 small dim mt-4"><Command size={12} />Arrow keys to navigate · Enter to open · Esc to close</div>
    </div>
  </Modal></>;
};
