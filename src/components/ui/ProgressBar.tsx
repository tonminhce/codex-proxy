import React from 'react';
import { clsx } from 'clsx';

interface ProgressBarProps {
  value: number; // 0 to 100
  label?: string;
  sublabel?: string;
  variant?: 'emerald' | 'amber' | 'rose' | 'indigo';
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  label,
  sublabel,
  variant = 'emerald',
}) => {
  const clamped = Math.min(100, Math.max(0, value));

  const colors = {
    emerald: 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_12px_rgba(16,185,129,0.35)]',
    amber: 'bg-gradient-to-r from-amber-500 to-orange-400 shadow-[0_0_12px_rgba(245,158,11,0.35)]',
    rose: 'bg-gradient-to-r from-rose-500 to-pink-500 shadow-[0_0_12px_rgba(244,63,94,0.35)]',
    indigo: 'bg-gradient-to-r from-indigo-500 to-violet-500 shadow-[0_0_12px_rgba(99,102,241,0.35)]',
  };

  const dynamicColor =
    variant === 'emerald'
      ? clamped > 30
        ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
        : clamped > 15
        ? 'bg-gradient-to-r from-amber-500 to-orange-400 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
        : 'bg-gradient-to-r from-rose-500 to-pink-500 shadow-[0_0_12px_rgba(244,63,94,0.35)]'
      : colors[variant];

  return (
    <div className="w-full space-y-1.5">
      {(label || sublabel) && (
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-400 font-sans text-[11px]">{label}</span>
          <span className="text-zinc-200 font-semibold">{sublabel || `${clamped}%`}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#131824] border border-[#1E2638]">
        <div
          className={clsx('h-full transition-all duration-500 ease-out rounded-full', dynamicColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};
