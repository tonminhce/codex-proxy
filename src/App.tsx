import React, { useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { NavTab } from './components/layout/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { AccountsPage } from './pages/AccountsPage';
import { GatewayPage } from './pages/GatewayPage';
import { InstancesPage } from './pages/InstancesPage';
import { WakeupPage } from './pages/WakeupPage';
import { InspectorPage } from './pages/InspectorPage';
import { SettingsPage } from './pages/SettingsPage';

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

  return (
    <AppLayout currentTab={currentTab} onSelectTab={setCurrentTab}>
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
