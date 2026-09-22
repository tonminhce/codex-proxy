import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useBackendError } from '../../lib/backend';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
}) => {
  const { error, clear } = useBackendError();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []);
    focusable()[0]?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => { window.removeEventListener('keydown', handleKeyDown); previousFocus?.focus(); };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#232B3E] bg-[#11141D] p-6 shadow-2xl shadow-black/80 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#1E2536]">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
            {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
          </div>
          <button
            aria-label="Close dialog"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && <div role="alert" className="mt-4 text-xs text-rose-300 border border-rose-500/30 rounded-lg p-3">{error}<button type="button" className="ml-3 underline" onClick={clear}>Dismiss</button></div>}
        <div className="pt-4">{children}</div>
      </div>
    </div>
  );
};
