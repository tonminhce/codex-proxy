import React, { useEffect, useState } from 'react';
import { Save, Monitor, SlidersHorizontal, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Field, Notice, PageHeader, Switch } from '../components/ui/Elements';
import { action, backend, isDesktop } from '../lib/backend';
interface Settings {
  codexHome: string;
  codexBinary: string;
  startGatewayOnLaunch: boolean;
  closeToTray: boolean;
  contextWindow: number | null;
  compactLimit: number | null;
  serviceTier: string | null;
}
const preview: Settings = {
  codexHome: '~/.codex',
  codexBinary: 'codex',
  startGatewayOnLaunch: false,
  closeToTray: true,
  contextWindow: null,
  compactLimit: null,
  serviceTier: null,
};
export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Settings>(preview);
  const [savedSettings, setSavedSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmApply, setConfirmApply] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = async () => {
    setLoadFailed(false);
    try {
      const loaded = await backend<Settings>('get_app_settings');
      setSettings(loaded);
      setSavedSettings(loaded);
    } catch {
      setLoadFailed(true);
    }
  };
  useEffect(() => {
    if (isDesktop()) void load();
  }, []);
  const disabled = !savedSettings || busy;
  const dirty = savedSettings && JSON.stringify(settings) !== JSON.stringify(savedSettings);
  const save = async (apply: boolean) => {
    if (!savedSettings) return;
    setBusy(true);
    setMessage('');
    const ok = await action(async () => {
      const saved = await backend<Settings>('save_app_settings', { settings });
      setSettings(saved);
      setSavedSettings(saved);
      if (apply) await backend('apply_codex_config');
    });
    if (ok) {
      setMessage(
        apply
          ? 'Selected overrides applied. Unrelated Codex settings were preserved.'
          : 'Application settings saved. Your Codex config was not changed.',
      );
      setConfirmApply(false);
    }
    setBusy(false);
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Make it yours"
        title="Settings"
        description="Local preferences, explicit changes. Nothing applied behind the scenes."
        actions={
          <>
            <span className="small dim">
              {dirty ? 'Unsaved changes' : savedSettings ? 'Up to date' : 'Preview'}
            </span>
            <Button
              variant="primary"
              loading={busy}
              disabled={disabled || !dirty}
              icon={<Save size={14} />}
              onClick={() => void save(false)}
            >
              Save changes
            </Button>
          </>
        }
      />
      {message && (
        <Notice tone="success" role="status">
          {message}
        </Notice>
      )}
      {!savedSettings && (
        <Notice>
          {loadFailed ? (
            <>
              Settings could not be loaded.{' '}
              <button className="underline" onClick={() => void load()}>
                Try again
              </button>
            </>
          ) : isDesktop() ? (
            'Loading your local settings…'
          ) : (
            'These are interface defaults, not your saved settings. Open the desktop app to edit them.'
          )}
        </Notice>
      )}
      <Card>
        <section className="settings-section">
          <div className="settings-intro">
            <Monitor size={18} className="dim mb-3" />
            <h2>Desktop & paths</h2>
            <p>Where Codex lives and how this app behaves.</p>
          </div>
          <fieldset disabled={disabled} className="stack">
            <Field label="Codex profile directory">
              <input
                className="input mono"
                value={settings.codexHome}
                onChange={(e) => setSettings({ ...settings, codexHome: e.target.value })}
              />
            </Field>
            <Field label="Codex CLI executable">
              <input
                className="input mono"
                value={settings.codexBinary}
                onChange={(e) => setSettings({ ...settings, codexBinary: e.target.value })}
              />
            </Field>
            <div>
              <Switch
                label="Start gateway on launch"
                description="Start the listener when CodexProxy opens."
                checked={settings.startGatewayOnLaunch}
                disabled={disabled}
                onChange={(value) => setSettings({ ...settings, startGatewayOnLaunch: value })}
              />
              <Switch
                label="Close to system tray"
                description="Keep the gateway available when the window closes."
                checked={settings.closeToTray}
                disabled={disabled}
                onChange={(value) => setSettings({ ...settings, closeToTray: value })}
              />
            </div>
            <p className="small dim">This does not install system-login autostart.</p>
          </fieldset>
        </section>
        <section className="settings-section">
          <div className="settings-intro">
            <SlidersHorizontal size={18} className="dim mb-3" />
            <h2>Codex overrides</h2>
            <p>Optional changes to your Codex config. Apply them separately.</p>
          </div>
          <fieldset disabled={disabled} className="stack">
            <Field
              label="Context window (tokens)"
              hint="Blank leaves the existing value unchanged."
            >
              <input
                className="input mono"
                type="number"
                min={1000}
                max={2000000}
                value={settings.contextWindow ?? ''}
                placeholder="Use existing configuration"
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    contextWindow: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </Field>
            <Field label="Auto-compact threshold (tokens)">
              <input
                className="input mono"
                type="number"
                min={1000}
                max={2000000}
                value={settings.compactLimit ?? ''}
                placeholder="Use existing configuration"
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    compactLimit: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </Field>
            <Field label="Service tier">
              <select
                className="input"
                value={settings.serviceTier ?? ''}
                onChange={(e) => setSettings({ ...settings, serviceTier: e.target.value || null })}
              >
                <option value="">Leave unchanged</option>
                <option value="fast">Fast · requires model and account support</option>
              </select>
            </Field>
            <Notice>
              Overrides cannot increase a model's actual capacity or your account entitlement.
              Unrelated settings are preserved, with a one-time backup.
            </Notice>
            <div className="actions justify-end">
              <Button
                disabled={disabled}
                icon={<ArrowUpRight size={14} />}
                onClick={() => setConfirmApply(true)}
              >
                Save & apply overrides
              </Button>
            </div>
          </fieldset>
        </section>
        <section className="settings-section">
          <div className="settings-intro">
            <ShieldCheck size={18} className="dim mb-3" />
            <h2>Designed to stay local</h2>
            <p>A focused interface with quiet defaults.</p>
          </div>
          <div className="stack">
            <div className="field-row pt-0">
              <div>
                Motion<p>Short transitions that follow your system's Reduce Motion preference.</p>
              </div>
              <span className="small accent">System</span>
            </div>
            <div className="field-row">
              <div>
                Data & privacy
                <p>
                  No analytics or payload logging. Credential files stay on this device; model
                  requests go to your selected provider.
                </p>
              </div>
            </div>
          </div>
        </section>
      </Card>
      <Modal
        isOpen={confirmApply}
        onClose={() => setConfirmApply(false)}
        dismissible={!busy}
        title="Apply Codex overrides?"
        description="This saves your preferences and edits config.toml in the configured Codex profile."
      >
        <div className="stack">
          <Notice>
            Only the nonblank overrides above are written. The first existing config is backed up;
            its other values are preserved.
          </Notice>
          <div className="modal-actions">
            <Button disabled={busy} onClick={() => setConfirmApply(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void save(true)}>
              Save & apply
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
