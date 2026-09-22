import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Info, Search } from 'lucide-react';
import { useBackendError } from '../../lib/backend';
import { Button } from './Button';
import { Modal } from './Modal';

export const PageHeader = ({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) => <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="actions">{actions}</div></header>;
export const SectionHead = ({ title, description, icon, action }: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode }) => <div className="section-head"><div><div className="section-head-title">{icon}<h2>{title}</h2></div>{description && <p>{description}</p>}</div>{action}</div>;
export const EmptyState = ({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) => <div className="empty-state"><div className="empty-icon" aria-hidden="true">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
export const Notice = ({ children, tone = '', role }: { children: React.ReactNode; tone?: '' | 'error' | 'success' | 'warning'; role?: 'alert' | 'status' }) => <div className={`notice ${tone ? `notice-${tone}` : ''}`} role={role}><Info size={14} aria-hidden="true" /><div>{children}</div></div>;
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
export const Switch = ({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) => {
  const id = useId();
  return <div className="field-row"><div><span id={id}>{label}</span>{description && <p>{description}</p>}</div><button type="button" className="switch" role="switch" aria-checked={checked} aria-labelledby={id} disabled={disabled} onClick={() => onChange(!checked)}><span /></button></div>;
};
export const CopyButton = ({ value, label = 'Copy', compact = false }: { value: string; label?: string; compact?: boolean }) => {
  const [copied, setCopied] = useState(false); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800); }
    catch { useBackendError.setState({ error: 'Could not access the clipboard. Select and copy the value manually.' }); }
  };
  return <button type="button" className={compact ? 'icon-button' : 'btn btn-ghost btn-sm'} aria-label={copied ? 'Copied' : label} title={copied ? 'Copied' : label} onClick={copy}>{copied ? <Check size={14} className="accent" /> : <Copy size={14} />}{!compact && <span aria-live="polite">{copied ? 'Copied' : label}</span>}</button>;
};
export const SearchField = ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => <div className="search-field"><Search size={15} aria-hidden="true" /><input className="input" type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} /></div>;
export const ConfirmDialog = ({ open, title, description, confirmLabel, onClose, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; onClose: () => void; onConfirm: () => Promise<boolean> }) => {
  const [busy, setBusy] = useState(false);
  return <Modal isOpen={open} onClose={onClose} title={title} description={description} dismissible={!busy}><div className="modal-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { if (await onConfirm()) onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button></div></Modal>;
};
