import React, { useId } from 'react';
interface SliderProps {
  min: number; max: number; step?: number; value: number; onChange: (value: number) => void;
  label?: string; description?: string; unit?: string; formatValue?: (value: number) => string;
  presets?: number[]; className?: string; disabled?: boolean;
}
export const Slider: React.FC<SliderProps> = ({ min, max, step = 1, value, onChange, label, description, unit = '', formatValue, presets, className, disabled = false }) => {
  const id = useId(); const format = (n: number) => formatValue ? formatValue(n) : n + unit;
  const percentage = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  return <div className={className}><div className="flex justify-between gap-4 mb-2"><label htmlFor={id}>{label}</label><span className="mono accent small">{format(value)}</span></div>{description && <p id={id + '-hint'} className="small muted mb-4">{description}</p>}
    <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label || 'Value'} aria-valuetext={format(value)} aria-describedby={description ? id + '-hint' : undefined} onChange={e => onChange(Number(e.target.value))} style={{ background: 'linear-gradient(to right, var(--accent) ' + percentage + '%, #3b444a ' + percentage + '%)' }} />
    {presets && <div className="actions mt-3">{presets.map(preset => <button type="button" className={'btn btn-sm ' + (value === preset ? 'btn-secondary accent' : 'btn-ghost')} key={preset} disabled={disabled} aria-pressed={value === preset} onClick={() => onChange(preset)}>{format(preset)}</button>)}</div>}
  </div>;
};
