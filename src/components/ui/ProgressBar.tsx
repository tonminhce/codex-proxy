import React from 'react';
interface ProgressBarProps {
  value: number;
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
  const clamped = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const color =
    variant === 'emerald' ? (clamped > 30 ? 'emerald' : clamped > 15 ? 'amber' : 'rose') : variant;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 small">
        <span className="muted">{label}</span>
        <span className="mono">{sublabel || clamped + '%'}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label || 'Remaining quota'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
      >
        <div className={'progress-fill ' + color} style={{ width: clamped + '%' }} />
      </div>
    </div>
  );
};
