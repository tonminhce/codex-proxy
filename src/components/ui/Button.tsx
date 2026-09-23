import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
}
const variants = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};
const sizes = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' };
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}) => (
  <button
    {...props}
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={twMerge(clsx('btn', variants[variant], sizes[size], className))}
  >
    {loading ? (
      <span className="spinner" aria-hidden="true" />
    ) : (
      icon && <span aria-hidden="true">{icon}</span>
    )}
    {children}
  </button>
);
