import React, { useState, useEffect } from 'react';
import {
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Shield,
  Globe,
  Sparkles,
  FileCode,
  Copy,
  Check,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { Modal } from '../components/ui/Modal';
import { useAccountStore } from '../stores/useAccountStore';
import { CodexAuthMode } from '../types/account';
import { isDesktop } from '../lib/backend';

export const AccountsPage: React.FC = () => {
  const {
    accounts,
    activeAccount,
    switchActiveAccount,
    refreshAccountQuota,
    deleteAccount,
    addAccount,
    importFromJson,
    startOAuthLogin,
    loadAccounts,
  } = useAccountStore();

  useEffect(() => {
    if (isDesktop()) void loadAccounts();
  }, [loadAccounts]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isAuthenticatingOAuth, setIsAuthenticatingOAuth] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<CodexAuthMode>('oauth');
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('https://api.openai.com/v1');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    await refreshAccountQuota(id);
    setTimeout(() => setRefreshingId(null), 600);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addMode === 'oauth') {
      setIsAuthenticatingOAuth(true);
      setOauthError(null);
      try {
        await startOAuthLogin();
        setIsAuthenticatingOAuth(false);
        setIsAddModalOpen(false);
      } catch (err: any) {
        setIsAuthenticatingOAuth(false);
        setOauthError(err?.message || err?.toString() || 'OAuth login failed');
      }
      return;
    }

    if (!await addAccount({
      authMode: addMode,
      email: emailInput || undefined,
      name: nameInput || undefined,
      apiKey: addMode === 'apikey' ? tokenInput : undefined,
      apiBaseUrl: addMode === 'apikey' ? baseUrlInput : undefined,
    })) return;
    setIsAddModalOpen(false);
    setEmailInput('');
    setNameInput('');
    setTokenInput('');
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importJsonText.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportSuccessMsg(null);
    try {
      const imported = await importFromJson(importJsonText);
      setImportSuccessMsg(`Successfully imported ${imported.length} Codex account(s)!`);
      setTimeout(() => {
        setIsImportModalOpen(false);
        setImportJsonText('');
        setImportSuccessMsg(null);
        setIsImporting(false);
      }, 900);
    } catch (err: any) {
      setImportError(err?.message || err?.toString() || 'Failed to import JSON');
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Codex Accounts</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Manage multiple OpenAI Codex profiles, OAuth tokens, and rate-limit quotas with 1-click switching.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            icon={<FileCode className="w-4 h-4 text-indigo-400" />}
            onClick={() => {
              setImportError(null);
              setImportSuccessMsg(null);
              setIsImportModalOpen(true);
            }}
          >
            Import JSON
          </Button>
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setIsAddModalOpen(true)}>
            Add Account
          </Button>
        </div>
      </div>

      {/* Accounts Grid */}
      {accounts.length === 0 && <Card><p className="text-sm text-zinc-400">No accounts connected. Sign in or import an auth.json file to begin. Imports do not overwrite your Codex profile.</p></Card>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((acc) => {
          const isActive = acc.id === activeAccount?.id;
          const initialLetter = (acc.name || acc.email || 'C').charAt(0).toUpperCase();

          return (
            <Card
              key={acc.id}
              elevated={isActive}
              className={`p-6 transition-all relative overflow-hidden flex flex-col justify-between ${
                isActive
                  ? 'border-indigo-500/50 bg-[#121626] ring-1 ring-indigo-500/20 shadow-xl shadow-indigo-950/40'
                  : 'bg-[#0E111A] hover:border-[#2A344A]'
              }`}
            >
              {acc.quota.updatedAt === 0 && <p className="mb-3 text-xs text-amber-300">Quota unknown — refresh an OAuth account to fetch current limits.</p>}
              {/* Top Row: Avatar, Identity, and Active State */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm select-none flex-shrink-0 ${
                        isActive
                          ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20'
                          : 'bg-zinc-800/80 border border-white/[0.06] text-zinc-300'
                      }`}
                    >
                      {initialLetter}
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm text-zinc-100 truncate max-w-[170px]">
                          {acc.name || acc.email}
                        </h3>
                        <Badge variant="indigo" className="uppercase text-[9px]">
                          {acc.planType}
                        </Badge>
                      </div>
                      <div className="text-xs text-zinc-400 font-mono flex items-center gap-2">
                        <span className="truncate max-w-[170px]">{acc.email}</span>
                        <span>•</span>
                        <span className="uppercase text-[10px] text-zinc-500">{acc.authMode}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isActive ? (
                      <Badge variant="emerald" dot>
                        Active Profile
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => switchActiveAccount(acc.id)}
                        className="text-xs hover:border-indigo-500/40 hover:text-indigo-300 transition"
                      >
                        Set Active
                      </Button>
                    )}
                  </div>
                </div>

                {/* Quotas & Limits Progress Bars */}
                <div className="mt-5 space-y-3 pt-4 border-t border-[#1E2536]">
                  <ProgressBar
                    value={acc.quota.hourly.remainingPercent}
                    label="Hourly Limit Window"
                    sublabel={`${acc.quota.hourly.remainingPercent}% Available`}
                  />
                  <ProgressBar
                    value={acc.quota.weekly.remainingPercent}
                    label="Weekly Account Window"
                    sublabel={`${acc.quota.weekly.remainingPercent}% Available`}
                  />
                </div>
              </div>

              {/* Bottom Card Footer: ID chip, Refresh, Delete */}
              <div className="mt-5 pt-3 border-t border-[#1E2536] flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-zinc-500">
                  <button
                    onClick={() => handleCopyId(acc.id)}
                    title="Copy Account ID"
                    className="flex items-center gap-1 font-mono text-[11px] text-zinc-500 hover:text-zinc-300 transition"
                  >
                    <span>ID: {acc.id.length > 12 ? `${acc.id.slice(0, 8)}...` : acc.id}</span>
                    {copiedId === acc.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 text-zinc-600 hover:text-zinc-400" />
                    )}
                  </button>
                  {acc.quota.lunaReserveAllowed && (
                    <>
                      <span>•</span>
                      <span className="text-[10px] text-amber-400/90 font-mono flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5" /> Luna
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRefresh(acc.id)}
                    disabled={acc.authMode !== 'oauth' || refreshingId === acc.id}
                    title="Refresh quota from OpenAI"
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${refreshingId === acc.id ? 'animate-spin text-indigo-400' : ''}`}
                    />
                  </button>
                    <button
                      onClick={() => { if (window.confirm('Remove this account from the local pool? Your existing Codex profile file will be kept.')) void deleteAccount(acc.id); }}
                      title="Remove profile"
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
              </div>
            </Card>
          );
        })}

        {/* Add Account Dashed Card Placeholder to balance grid */}
        <div
          onClick={() => setIsAddModalOpen(true)}
          className="border border-dashed border-[#1E2536] hover:border-indigo-500/40 rounded-xl p-6 flex flex-col items-center justify-center min-h-[200px] cursor-pointer group bg-[#0A0C14]/40 hover:bg-[#101422]/60 transition-all text-center space-y-2 select-none"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-105 transition-transform">
            <Plus className="w-5 h-5" />
          </div>
          <div className="text-sm font-semibold text-zinc-300 group-hover:text-zinc-100">Add Codex Account</div>
          <p className="text-xs text-zinc-500 max-w-xs">
            Connect another OpenAI ChatGPT subscription or third-party token for pooled rotation.
          </p>
        </div>
      </div>

      {/* Add Account Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Codex Account"
        description="Connect an official ChatGPT subscription or third-party provider."
      >
        <div className="space-y-4">
          {/* Mode Selector Tabs */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#090B11] border border-[#1E2536]">
            <button
              type="button"
              onClick={() => setAddMode('oauth')}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition ${
                addMode === 'oauth'
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>OAuth (ChatGPT)</span>
            </button>
            <button
              type="button"
              onClick={() => setAddMode('apikey')}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition ${
                addMode === 'apikey'
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>API Key</span>
            </button>
          </div>

          <form onSubmit={handleAddSubmit} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Account Label</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Work ChatGPT Plus"
                className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
              />
            </div>

            {addMode === 'oauth' && (
              <div className="space-y-3">
                {isAuthenticatingOAuth ? (
                  <div className="p-5 rounded-xl bg-indigo-600/10 border border-indigo-500/30 text-center space-y-2">
                    <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
                    <div className="text-sm font-semibold text-zinc-100">Waiting for OpenAI Authorization...</div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Your default browser has been opened to <code className="text-indigo-300">auth.openai.com</code>.
                      Log in to your account and approve connection to finish.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-xs text-indigo-200 space-y-2">
                    <div className="font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                      <span>Official PKCE Loopback Authorization</span>
                    </div>
                    <p className="text-zinc-400 text-[11px] leading-relaxed">
                      Clicking "Authenticate with OpenAI" will spawn a local loopback callback and open your browser.
                      Tokens are saved in the local account pool. Only an explicit account switch updates your Codex profile.
                    </p>
                  </div>
                )}

                {oauthError && (
                  <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-lg text-xs text-red-400 font-mono">
                    {oauthError}
                  </div>
                )}
              </div>
            )}

            {addMode === 'apikey' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">Base URL</label>
                  <input
                    type="url"
                    required
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1">API Key</label>
                  <input
                    type="password"
                    required
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2536]">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsAddModalOpen(false);
                  setIsAuthenticatingOAuth(false);
                  setOauthError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={isAuthenticatingOAuth}>
                {addMode === 'oauth'
                  ? isAuthenticatingOAuth
                    ? 'Connecting...'
                    : 'Authenticate with OpenAI'
                  : 'Save Account'}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Import JSON Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title="Import Codex Accounts from JSON"
      >
        <form onSubmit={handleImportSubmit} className="space-y-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            Paste your exported Codex tokens array or object below (supports id_token, access_token, refresh_token, and account_id).
          </p>

          <div>
            <textarea
              required
              rows={8}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder={`[\n  {\n    "id_token": "eyJhbGciOi...",\n    "access_token": "eyJhbGciOi...",\n    "refresh_token": "rt.1...",\n    "account_id": "...",\n    "email": "user@example.com"\n  }\n]`}
              className="w-full px-3 py-2.5 bg-[#090B11] border border-[#1E2536] rounded-lg text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          {importError && (
            <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-lg text-xs text-red-400 font-mono">
              {importError}
            </div>
          )}

          {importSuccessMsg && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-900/50 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>{importSuccessMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1E2536]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setIsImportModalOpen(false);
                setImportError(null);
                setImportSuccessMsg(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isImporting}>
              Import Accounts
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
