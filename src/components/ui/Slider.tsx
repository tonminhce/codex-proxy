import React from 'react';
import { clsx } from 'clsx';

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  label?: string;
  description?: string;
  unit?: string;
  formatValue?: (value: number) => string;
  presets?: number[];
  className?: string;
  disabled?: boolean;
}

export const Slider: React.FC<SliderProps> = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  description,
  unit = '',
  formatValue,
  presets,
  className,
  disabled = false,
}) => {
  const percentage = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  const displayValue = formatValue ? formatValue(value) : `${value}${unit}`;

  return (
    <div className={clsx('space-y-2.5', className)}>
      {(label || description) && (
        <div className="flex items-center justify-between">
          <div>
            {label && <span className="text-xs font-semibold text-zinc-200">{label}</span>}
            {description && <p className="text-[11px] text-zinc-500 mt-0.5">{description}</p>}
          </div>
          <span className="font-mono text-xs text-indigo-400 font-semibold px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
            {displayValue}
          </span>
        </div>
      )}

      {/* Slider Track and Thumb */}
      <div className="relative flex items-center select-none py-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            background: `linear-gradient(to right, #6366f1 0%, #818cf8 ${percentage}%, #1E2536 ${percentage}%, #1E2536 100%)`,
          }}
          className={clsx(
            'w-full h-2 rounded-full cursor-pointer appearance-none transition-all outline-none',
            'focus:ring-2 focus:ring-indigo-500/30',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
      </div>

      {/* Quick Presets (Optional) */}
      {presets && presets.length > 0 && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono mr-1">Presets:</span>
          {presets.map((preset) => {
            const isSelected = value === preset;
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => onChange(preset)}
                className={clsx(
                  'text-[10px] font-mono px-2 py-0.5 rounded-md transition-all',
                  isSelected
                    ? 'bg-indigo-600 text-white font-medium shadow-sm shadow-indigo-600/30'
                    : 'bg-[#141924] hover:bg-[#1E2536] text-zinc-400 hover:text-zinc-200 border border-[#232B3E]'
                )}
              >
                {formatValue ? formatValue(preset) : `${preset}${unit}`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
