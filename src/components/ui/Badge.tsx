import React from 'react';
import { clsx } from 'clsx';
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> { variant?: 'emerald' | 'amber' | 'rose' | 'indigo' | 'zinc'; dot?: boolean; }
export const Badge: React.FC<BadgeProps> = ({ variant = 'zinc', dot = false, className, children, ...props }) => <span {...props} className={clsx('badge whitespace-nowrap flex-shrink-0', 'badge-' + variant, className)}>{dot && <span className="status-dot" aria-hidden="true" />}{children}</span>;
