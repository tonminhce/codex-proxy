import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg'; icon?: React.ReactNode; loading?: boolean;
}
export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', size = 'md', icon, loading = false, disabled, className, children, type = 'button', ...props }) => (
  <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={twMerge(clsx('btn', 'btn-' + variant, 'btn-' + size, className))}>
    {loading ? <span className="spinner" aria-hidden="true" /> : icon && <span aria-hidden="true">{icon}</span>}{children}
  </button>
);
