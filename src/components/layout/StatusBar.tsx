import React from 'react';
import { ShieldCheck, Cpu } from 'lucide-react';
import { useGatewayStore } from '../../stores/useGatewayStore';
import { useAccountStore } from '../../stores/useAccountStore';
import { isDesktop } from '../../lib/backend';
export const StatusBar: React.FC = () => {
  const { running, port } = useGatewayStore();
  const active = useAccountStore((s) => s.activeAccount);
  return (
    <footer className="statusbar mono">
      <div className="statusbar-group whitespace-nowrap flex-shrink-0">
        <span className={'status-dot ' + (running ? 'accent' : 'dim')} />
        <span>
          {isDesktop() ? (running ? '127.0.0.1:' + port : 'Gateway stopped') : 'Browser preview'}
        </span>
        <span className="dim">/</span>
        <span className="truncate-text max-w-[200px]">{active?.email || 'No active profile'}</span>
      </div>
      <div className="statusbar-group statusbar-secondary whitespace-nowrap flex-shrink-0">
        <ShieldCheck size={11} />
        <span>No payload logging</span>
        <span className="dim">·</span>
        <Cpu size={11} />
        <span>Rust in-process</span>
      </div>
    </footer>
  );
};
