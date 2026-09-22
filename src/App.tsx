import React, { useState, useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { NavTab } from './components/layout/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { AccountsPage } from './pages/AccountsPage';
import { GatewayPage } from './pages/GatewayPage';
import { InstancesPage } from './pages/InstancesPage';
import { WakeupPage } from './pages/WakeupPage';
import { InspectorPage } from './pages/InspectorPage';
import { SettingsPage } from './pages/SettingsPage';
import { isDesktop, useBackendError } from './lib/backend';
import { useGatewayStore } from './stores/useGatewayStore';
import { useAccountStore } from './stores/useAccountStore';
import { useLogStore } from './stores/useLogStore';
import { useWakeupStore } from './stores/useWakeupStore';
import { useInstanceStore } from './stores/useInstanceStore';

export const App: React.FC = () => {
  const getInitialTab = (): NavTab => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as NavTab;
    if (tabParam && ['dashboard', 'accounts', 'wakeup', 'gateway', 'instances', 'inspector', 'settings'].includes(tabParam)) {
      return tabParam;
    }
    return 'dashboard';
  };

  const [currentTab, setCurrentTab] = useState<NavTab>(getInitialTab);
  const { error, clear } = useBackendError();
  useEffect(() => {
    if (!isDesktop()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const sync = async () => {
      await Promise.all([
        useGatewayStore.getState().loadGateway(), useAccountStore.getState().loadAccounts(),
        useLogStore.getState().loadLogs(), useWakeupStore.getState().loadTasks(),
        useInstanceStore.getState().loadInstances(),
      ]);
      if (!stopped) timer = setTimeout(sync, 3000);
    };
    void sync();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  return (
    <AppLayout currentTab={currentTab} onSelectTab={setCurrentTab}>
      {!isDesktop() && <div role="status" className="mb-5 rounded-lg border border-amber-500/30 p-3 text-xs text-amber-300">Browser preview only. No backend is connected; run <code>npm run tauri:dev</code> for live features.</div>}
      {error && <div role="alert" className="mb-5 flex justify-between gap-4 rounded-lg border border-rose-500/30 p-3 text-xs text-rose-300"><span>{error}</span><button onClick={clear}>Dismiss</button></div>}
      {currentTab === 'dashboard' && <DashboardPage onNavigate={setCurrentTab} />}
      {currentTab === 'accounts' && <AccountsPage />}
      {currentTab === 'wakeup' && <WakeupPage />}
      {currentTab === 'gateway' && <GatewayPage />}
      {currentTab === 'instances' && <InstancesPage />}
      {currentTab === 'inspector' && <InspectorPage />}
      {currentTab === 'settings' && <SettingsPage />}
    </AppLayout>
  );
};

export default App;
