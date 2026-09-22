import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export const Card: React.FC<CardProps> = ({ className, elevated, children, ...props }) => {
  return (
    <div
      className={twMerge(
        clsx(
          'rounded-xl border border-[#1E2536] p-5 transition-all',
          elevated ? 'bg-[#121622]/90 shadow-lg' : 'bg-[#0E111A]/80 hover:border-[#2A344C]',
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
};
