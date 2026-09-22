import React, { useState } from 'react';
import {
  Cpu,
  Sliders,
  Save,
  Check,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Slider } from '../components/ui/Slider';

export const SettingsPage: React.FC = () => {
  const [context1M, setContext1M] = useState(true);
  const [compactLimit, setCompactLimit] = useState(400000);
  const [speedTier, setSpeedTier] = useState<'standard' | 'fast' | 'ultrafast'>('fast');
  const [autostart, setAutostart] = useState(true);
  const [closeToTray, setCloseToTray] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Application Settings</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Configure Codex desktop profile overrides, context limits, and desktop runtime behaviors.
          </p>
        </div>
        <Button variant="primary" icon={saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />} onClick={handleSave}>
          {saved ? 'Saved' : 'Save Changes'}
        </Button>
      </div>

      {/* Codex Profile Configuration */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-2.5 pb-2 border-b border-[#1E2536]">
          <Cpu className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-sm text-zinc-100">Codex Config Injections (~/.codex/config.toml)</h3>
        </div>

        {/* 1M Context Window */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-xs font-semibold text-zinc-200">1 Million Token Context Window</span>
            <p className="text-[11px] text-zinc-500">
              Enables experimental 1M token context capacity for supported OpenAI Codex models.
            </p>
          </div>
          <input
            type="checkbox"
            checked={context1M}
            onChange={(e) => setContext1M(e.target.checked)}
            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
          />
        </div>

        {/* Auto-Compact Token Limit */}
        <div className="pt-3 border-t border-[#1E2536]">
          <Slider
            min={100000}
            max={800000}
            step={50000}
            value={compactLimit}
            onChange={setCompactLimit}
            label="Auto-Compact Token Threshold"
            description="Compacts conversation memory once tokens exceed this threshold."
            formatValue={(tokens) => `${(tokens / 1000).toFixed(0)}k tokens`}
            presets={[200000, 400000, 600000, 800000]}
          />
        </div>

        {/* Official App Speed Tier */}
        <div className="space-y-2 pt-3 border-t border-[#1E2536]">
          <div className="text-xs font-semibold text-zinc-200">Codex Service Speed Tier</div>
          <p className="text-[11px] text-zinc-500 mb-2">Controls OpenAI priority tier injection for streaming completions.</p>
          <div className="grid grid-cols-3 gap-3 text-xs">
            {(['standard', 'fast', 'ultrafast'] as const).map((tier) => (
              <button
                key={tier}
                type="button"
                onClick={() => setSpeedTier(tier)}
                className={`p-3 rounded-xl border text-left capitalize transition ${
                  speedTier === tier
                    ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300 font-semibold'
                    : 'bg-[#090B11] border-[#1E2536] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div>{tier}</div>
                <div className="text-[10px] text-zinc-500 lowercase mt-0.5">
                  {tier === 'standard' && 'Default rate'}
                  {tier === 'fast' && 'Low-latency priority'}
                  {tier === 'ultrafast' && 'Maximum accelerator tier'}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Desktop Runtime Settings */}
      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-2.5 pb-2 border-b border-[#1E2536]">
          <Sliders className="w-4 h-4 text-indigo-400" />
          <h3 className="font-semibold text-sm text-zinc-100">Desktop Shell Preferences</h3>
        </div>

        <div className="space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium text-zinc-200">Launch at System Startup</span>
              <p className="text-[11px] text-zinc-500">Automatically starts the proxy gateway in tray mode on boot.</p>
            </div>
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[#1E2536]">
            <div>
              <span className="font-medium text-zinc-200">Close Window to System Tray</span>
              <p className="text-[11px] text-zinc-500">Keep the local proxy running in the background when window is closed.</p>
            </div>
            <input
              type="checkbox"
              checked={closeToTray}
              onChange={(e) => setCloseToTray(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
            />
          </div>
        </div>
      </Card>
    </div>
  );
};
