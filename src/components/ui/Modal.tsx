import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, X } from 'lucide-react';
import { useBackendError } from '../../lib/backend';
interface ModalProps { isOpen: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; dismissible?: boolean; }
export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, description, children, dismissible = true }) => {
  const { error, clear } = useBackendError(); const id = useId();
  const dialog = useRef<HTMLDivElement>(null); const close = useRef(onClose); const canClose = useRef(dismissible);
  close.current = onClose; canClose.current = dismissible;
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const shell = document.getElementById('app-shell'); const previousInert = shell?.inert;
    if (shell) shell.inert = true;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]') || []);
    const firstField = dialog.current?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])');
    (firstField || focusable()[0] || dialog.current)?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (canClose.current) close.current(); }
      if (e.key === 'Tab') {
        const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
        if (!first) { e.preventDefault(); dialog.current?.focus(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (shell) shell.inert = previousInert || false; previousFocus?.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  return createPortal(<div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && dismissible) onClose(); }}><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={description ? id + '-description' : undefined} tabIndex={-1}>
    <div className="modal-head"><div><h2 id={id}>{title}</h2>{description && <p id={id + '-description'}>{description}</p>}</div><button type="button" className="icon-button" aria-label="Close dialog" disabled={!dismissible} onClick={onClose}><X size={17} /></button></div>
    {error && <div role="alert" className="notice notice-error mb-5"><AlertCircle size={15} /><span className="flex-1">{error}</span><button type="button" className="icon-button" aria-label="Dismiss error" onClick={clear}><X size={14} /></button></div>}{children}
  </div></div>, document.body);
};
