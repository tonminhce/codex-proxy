import React, { useState } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  FileJson,
  Users,
  Search,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Modal } from '../components/ui/Modal';
import {
  ConfirmDialog,
  CopyButton,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SearchField,
} from '../components/ui/Elements';
import { useAccountStore } from '../stores/useAccountStore';
import { useBackendError } from '../lib/backend';
import { CodexAccount } from '../types/account';

export const AccountsPage: React.FC = () => {
  const store = useAccountStore();
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<'add' | 'import' | null>(null);
  const [mode, setMode] = useState<'oauth' | 'apikey'>('oauth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [remove, setRemove] = useState<CodexAccount | null>(null);
  const [activate, setActivate] = useState<CodexAccount | null>(null);
  const filtered = store.accounts.filter((a) =>
    (a.name + ' ' + a.email + ' ' + a.planType).toLowerCase().includes(query.toLowerCase()),
  );
  const open = (kind: 'add' | 'import') => {
    useBackendError.getState().clear();
    setModal(kind);
  };
  const close = () => {
    setModal(null);
    setToken('');
    setJson('');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (modal === 'import') {
        const result = await store.importFromJson(json);
        setMessage(
          result.length + ' account(s) imported. Your external Codex profile was not changed.',
        );
        close();
      } else if (mode === 'oauth') {
        await store.startOAuthLogin();
        setMessage('Account connected. You can now use it in your gateway.');
        close();
      } else if (
        await store.addAccount({
          authMode: 'apikey',
          name: name || undefined,
          email: email || undefined,
          apiKey: token,
          apiBaseUrl: baseUrl,
        })
      ) {
        setMessage('API-key account saved locally.');
        close();
        setName('');
        setEmail('');
      }
    } catch {
      /* backend renders a safe error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Identity & access"
        title="Connected accounts"
        description="Your Codex profiles, together. Keep credentials local and usage in view."
        actions={
          <>
            <Button icon={<FileJson size={14} />} onClick={() => open('import')}>
              Import JSON
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => open('add')}>
              Add account
            </Button>
          </>
        }
      />
      {message && (
        <Notice tone="success" role="status">
          {message}
        </Notice>
      )}
      <div className="toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Search accounts…" />
        <span className="small muted">
          {store.accounts.length} account{store.accounts.length === 1 ? '' : 's'}
          <span className="mx-2 dim">/</span>
          <span className="accent">
            {store.accounts.filter((a) => a.authMode === 'oauth').length} OAuth
          </span>
        </span>
      </div>
      {!filtered.length ? (
        <Card>
          <EmptyState
            icon={query ? <Search size={23} /> : <Users size={23} />}
            title={query ? 'No matching accounts' : 'Your accounts belong here'}
            description={
              query
                ? 'Try a different name, email, or plan.'
                : 'Connect a ChatGPT subscription or API-key account to start building your local pool.'
            }
            action={
              query ? (
                <Button onClick={() => setQuery('')}>Clear search</Button>
              ) : (
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => open('add')}>
                  Connect your first account
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="two-col">
          {filtered.map((account) => (
            <Card className="account-card" elevated={account.isActive} key={account.id}>
              <div className="account-card-head">
                <div className="account-identity">
                  <div className="avatar">
                    {(account.name || account.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate-text" title={account.name || account.email}>
                      {account.name || account.email}
                    </h2>
                    <p className="small muted truncate-text" title={account.email}>
                      {account.email}
                    </p>
                  </div>
                </div>
                <Badge variant={account.isActive ? 'emerald' : 'zinc'} dot>
                  {account.isActive ? 'Active' : account.isCooldown ? 'Cooldown' : 'Standby'}
                </Badge>
              </div>
              <div className="actions">
                <Badge>{account.authMode === 'oauth' ? 'ChatGPT OAuth' : 'API key'}</Badge>
                <Badge variant="indigo">{account.planType}</Badge>
                <span className="small dim ml-auto">
                  {account.authMode === 'oauth' ? 'OpenAI' : 'Provider account'}
                </span>
              </div>
              {account.authMode === 'oauth' && account.quota.updatedAt > 0 ? (
                <div className="quota-grid">
                  <ProgressBar
                    label="Primary remaining"
                    value={account.quota.hourly.remainingPercent}
                  />
                  <ProgressBar
                    label="Weekly remaining"
                    value={account.quota.weekly.remainingPercent}
                  />
                </div>
              ) : (
                <div className="notice">
                  <ShieldCheck size={15} />
                  <span>
                    {account.authMode === 'oauth'
                      ? 'Quota not fetched. Refresh to check current usage.'
                      : 'Usage limits are managed by the upstream provider.'}
                  </span>
                </div>
              )}
              <div className="account-footer">
                <div className="actions">
                  <CopyButton
                    compact
                    value={account.id}
                    label={'Copy account ID for ' + account.email}
                  />
                  <button
                    className="icon-button"
                    aria-label={'Refresh quota for ' + account.email}
                    title="Refresh quota"
                    disabled={pendingId !== null || account.authMode !== 'oauth'}
                    onClick={async () => {
                      setPendingId(account.id);
                      try {
                        await store.refreshAccountQuota(account.id);
                      } finally {
                        setPendingId(null);
                      }
                    }}
                  >
                    {pendingId === account.id ? (
                      <span className="spinner" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={'Remove ' + account.email}
                    title="Remove account"
                    onClick={() => {
                      useBackendError.getState().clear();
                      setRemove(account);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Button
                  size="sm"
                  variant={account.isActive ? 'ghost' : 'secondary'}
                  onClick={() => {
                    useBackendError.getState().clear();
                    setActivate(account);
                  }}
                >
                  {account.isActive ? 'Sync Codex profile' : 'Use in Codex'}
                  <ArrowRight size={13} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Notice>
        <strong>Profile switching is explicit.</strong> Imports only update this account pool. “Use
        in Codex” writes the selected account to your configured Codex auth file, with a backup.
      </Notice>
      <Modal
        isOpen={modal !== null}
        onClose={close}
        dismissible={!busy}
        title={modal === 'import' ? 'Import accounts' : 'Connect an account'}
        description={
          modal === 'import'
            ? 'Paste an auth.json object or an array of exported accounts.'
            : 'Choose how you want to authenticate.'
        }
      >
        <form className="stack" onSubmit={submit}>
          {modal === 'import' ? (
            <Field
              label="Account JSON"
              hint="Sensitive credentials are saved locally and never included in request logs."
            >
              <textarea
                className="input mono"
                rows={9}
                required
                spellCheck={false}
                autoComplete="off"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder={
                  '{\n  "tokens": {\n    "access_token": "…",\n    "id_token": "…"\n  }\n}'
                }
              />
            </Field>
          ) : (
            <>
              <div className="choice-grid">
                <button
                  type="button"
                  className="choice"
                  aria-pressed={mode === 'oauth'}
                  disabled={busy}
                  onClick={() => setMode('oauth')}
                >
                  <ShieldCheck size={19} className="accent" />
                  <strong>ChatGPT</strong>
                  <small>Secure browser sign-in</small>
                </button>
                <button
                  type="button"
                  className="choice"
                  aria-pressed={mode === 'apikey'}
                  disabled={busy}
                  onClick={() => setMode('apikey')}
                >
                  <KeyRound size={19} className="accent" />
                  <strong>API key</strong>
                  <small>OpenAI or a custom provider</small>
                </button>
              </div>
              {mode === 'oauth' ? (
                <Notice>
                  {busy
                    ? 'Waiting for browser authorization. Finish signing in in the browser. This can take up to three minutes.'
                    : 'Your browser will open for authorization. Credentials are saved in the local pool; your existing Codex profile stays unchanged.'}
                </Notice>
              ) : (
                <>
                  <Field label="Account label">
                    <input
                      className="input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Work API"
                    />
                  </Field>
                  <Field label="Email (optional)">
                    <input
                      className="input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </Field>
                  <Field label="Provider base URL">
                    <input
                      className="input mono"
                      type="url"
                      required
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </Field>
                  <Field label="API key">
                    <input
                      className="input mono"
                      type="password"
                      required
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Paste your provider key"
                    />
                  </Field>
                </>
              )}
            </>
          )}
          <div className="modal-actions">
            <Button variant="ghost" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              {modal === 'import'
                ? 'Import accounts'
                : mode === 'oauth'
                  ? 'Continue with OpenAI'
                  : 'Save account'}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={remove !== null}
        title="Remove this account?"
        description="This removes the account from the local pool. Your existing Codex profile file is kept."
        confirmLabel="Remove account"
        onClose={() => setRemove(null)}
        onConfirm={() => store.deleteAccount(remove!.id)}
      />
      <ConfirmDialog
        destructive={false}
        open={activate !== null}
        title="Update your Codex profile?"
        description={
          'Switch the configured Codex auth file to ' +
          (activate?.email || '') +
          '. An existing file is backed up before the first switch.'
        }
        confirmLabel="Update profile"
        onClose={() => setActivate(null)}
        onConfirm={() => store.switchActiveAccount(activate!.id)}
      />
    </div>
  );
};
