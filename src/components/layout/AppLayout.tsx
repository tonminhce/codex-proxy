import React from 'react';
import { Sidebar, NavTab } from './Sidebar';
import { StatusBar } from './StatusBar';

interface AppLayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentTab,
  onSelectTab,
  children,
}) => {
  return (
    <div className="flex h-screen w-screen bg-[#090A0F] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.08),rgba(255,255,255,0))] text-zinc-100 overflow-hidden font-sans select-none">
      <Sidebar currentTab={currentTab} onSelectTab={onSelectTab} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Window Drag Strip for macOS / Desktop */}
        <div data-tauri-drag-region className="h-10 w-full flex-shrink-0 cursor-default bg-transparent select-none" />
        <main className="flex-1 overflow-y-auto px-8 pb-10 pt-1 select-text scroll-smooth">{children}</main>
        <StatusBar />
      </div>
    </div>
  );
};
