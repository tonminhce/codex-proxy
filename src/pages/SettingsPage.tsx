import React, { useEffect, useState } from 'react';
import { Save, Sliders } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { action, backend, isDesktop } from '../lib/backend';

interface Settings {
  codexHome: string; codexBinary: string; startGatewayOnLaunch: boolean; closeToTray: boolean;
  contextWindow: number | null; compactLimit: number | null; serviceTier: string | null;
}
export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (isDesktop()) void backend<Settings>('get_app_settings').then(setSettings).catch(() => {});
  }, []);
  const save = async (apply: boolean) => {
    if (!settings) return;
    setBusy(true); setMessage('');
    const ok = await action(async () => {
      setSettings(await backend<Settings>('save_app_settings', { settings }));
      if (apply) await backend('apply_codex_config');
    });
    if (ok) setMessage(apply ? 'Saved and applied selected Codex overrides. Existing config was backed up.' : 'Application settings saved. Codex config was not changed.');
    setBusy(false);
  };
  const field = 'mt-2 w-full rounded-lg border border-[#1E2536] bg-[#090B11] px-3 py-2 text-sm text-zinc-100';
  if (!settings) return <Card>Open the desktop app to load local application settings.</Card>;
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Application Settings</h1><p className="text-xs text-zinc-400 mt-1">Local paths, desktop behavior, and explicit Codex configuration overrides.</p></div>
        <Button disabled={busy} onClick={() => save(false)} icon={<Save className="w-4 h-4" />}>Save Changes</Button>
      </div>
      {message && <p role="status" className="text-sm text-emerald-400">{message}</p>}
      <Card className="p-6 space-y-5 text-xs">
        <h2 className="text-sm font-semibold flex gap-2"><Sliders className="w-4 h-4" />Desktop preferences</h2>
        <label className="block">Codex profile directory<input className={field} value={settings.codexHome} onChange={e => setSettings({ ...settings, codexHome: e.target.value })} /></label>
        <label className="block">Codex CLI executable<input className={field} value={settings.codexBinary} onChange={e => setSettings({ ...settings, codexBinary: e.target.value })} /></label>
        <label className="flex justify-between">Start gateway when CodexProxy opens<input type="checkbox" checked={settings.startGatewayOnLaunch} onChange={e => setSettings({ ...settings, startGatewayOnLaunch: e.target.checked })} /></label>
        <label className="flex justify-between">Close window to system tray<input type="checkbox" checked={settings.closeToTray} onChange={e => setSettings({ ...settings, closeToTray: e.target.checked })} /></label>
        <p className="text-zinc-500">System-login autostart is not installed. These preferences take effect within CodexProxy.</p>
      </Card>
      <Card className="p-6 space-y-5 text-xs">
        <h2 className="text-sm font-semibold">Optional Codex config overrides</h2>
        <p className="text-zinc-400">These values cannot increase a model's actual capacity or account entitlement. Blank fields leave existing values unchanged. Applying edits preserves other TOML settings and creates a one-time backup.</p>
        <label className="block">Context window (tokens)<input type="number" min={1000} max={2000000} placeholder="Leave unchanged" className={field} value={settings.contextWindow ?? ''} onChange={e => setSettings({ ...settings, contextWindow: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="block">Auto-compact threshold (tokens)<input type="number" min={1000} max={2000000} placeholder="Leave unchanged" className={field} value={settings.compactLimit ?? ''} onChange={e => setSettings({ ...settings, compactLimit: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="block">Service tier<select className={field} value={settings.serviceTier ?? ''} onChange={e => setSettings({ ...settings, serviceTier: e.target.value || null })}><option value="">Leave unchanged</option><option value="fast">Fast (requires model/account support)</option></select></label>
        <Button disabled={busy} onClick={() => save(true)}>Save and apply to Codex config</Button>
      </Card>
    </div>
  );
};
