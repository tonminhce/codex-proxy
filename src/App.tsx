import React, { useState, useEffect } from 'react';
import { AlertCircle, Monitor, X } from 'lucide-react';
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
      {!isDesktop() && <div role="status" className="preview-strip"><Monitor size={13} /><span>Interface preview</span><span className="dim">·</span><span>Open the desktop app for live features.</span><code className="ml-auto">npm run tauri:dev</code></div>}
      {error && <div role="alert" className="notice notice-error error-strip"><AlertCircle size={15} /><span className="flex-1">{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={clear}><X size={14} /></button></div>}
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
